//! Pure Rust Native In-Process PDF Rendering Module.
//!
//! Provides zero-external-dependency, memory-safe PDF 1.4 generation for student essays,
//! grading rubrics, and proof-of-write verification reports.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fmt::Write as FmtWrite;
use std::io::Write as IoWrite;
use std::sync::LazyLock;
use thiserror::Error;

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static HTML_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<[^>]*>").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static ENTITY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)&[a-z]+;|&#\d+;|&#x[0-9a-f]+;").expect("valid regex"));

/// Maximum allowed pages in a rendered PDF document.
pub const MAX_PDF_PAGES: usize = 100;

/// Errors that may occur during PDF generation.
#[derive(Debug, Error)]
pub enum PdfRenderError {
    /// Provided essay or document content was empty.
    #[error("Document content cannot be empty")]
    EmptyContent,

    /// Document exceeds maximum allowed page ceiling.
    #[error("Document exceeds maximum page ceiling of 100 pages")]
    DocumentTooLarge,

    /// Text encoding or formatting failure.
    #[error("PDF formatting error: {0}")]
    FormatError(String),
}

/// Request payload for native PDF rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderPdfRequest {
    /// Document title.
    #[serde(default)]
    pub title: Option<String>,
    /// Raw text or sanitized HTML content.
    pub content: String,
    /// Author / student name.
    #[serde(default)]
    pub author: Option<String>,
    /// Optional subtitle or assignment name.
    #[serde(default)]
    pub subtitle: Option<String>,
}

/// Escapes literal characters for PDF text strings `(...)`.
pub fn escape_pdf_string(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            '\r' => out.push(' '),
            '\n' => out.push(' '),
            '\t' => out.push_str("    "),
            c if c.is_ascii() => out.push(c),
            // Map non-ASCII unicode characters to ascii approximations or question marks for standard Type 1 Helvetica
            '’' | '‘' => out.push('\''),
            '“' | '”' => out.push('"'),
            '–' | '—' => out.push('-'),
            '…' => out.push_str("..."),
            c => {
                // For accented latin characters, map to safe ascii representation
                match c {
                    'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => out.push('a'),
                    'Á' | 'À' | 'Â' | 'Ä' | 'Ã' | 'Å' => out.push('A'),
                    'é' | 'è' | 'ê' | 'ë' => out.push('e'),
                    'É' | 'È' | 'Ê' | 'Ë' => out.push('E'),
                    'í' | 'ì' | 'î' | 'ï' => out.push('i'),
                    'Í' | 'Ì' | 'Î' | 'Ï' => out.push('I'),
                    'ó' | 'ò' | 'ô' | 'ö' | 'õ' => out.push('o'),
                    'Ó' | 'Ò' | 'Ô' | 'Ö' | 'Õ' => out.push('O'),
                    'ú' | 'ù' | 'û' | 'ü' => out.push('u'),
                    'Ú' | 'Ù' | 'Û' | 'Ü' => out.push('U'),
                    'ñ' => out.push('n'),
                    'Ñ' => out.push('N'),
                    'ç' => out.push('c'),
                    'Ç' => out.push('C'),
                    _ => out.push('?'),
                }
            }
        }
    }
    out
}

/// Normalizes HTML content into clean lines of text.
pub fn extract_lines_from_content(raw: &str) -> Vec<String> {
    // Replace <br>, </p>, </h1>..</h6>, </div> with newlines
    let s = raw
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n\n")
        .replace("</h1>", "\n\n")
        .replace("</h2>", "\n\n")
        .replace("</h3>", "\n\n")
        .replace("</h4>", "\n\n")
        .replace("</h5>", "\n\n")
        .replace("</h6>", "\n\n")
        .replace("</blockquote>", "\n\n")
        .replace("</div>", "\n")
        .replace("</tr>", "\n")
        .replace("</li>", "\n");

    let s = HTML_TAG_RE.replace_all(&s, "");
    let s = ENTITY_RE.replace_all(&s, " ");

    let mut lines = Vec::new();
    for raw_line in s.lines() {
        let trimmed = raw_line.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        } else if !lines.is_empty() && lines.last().map(|l| !l.is_empty()).unwrap_or(false) {
            lines.push(String::new()); // preserve paragraph separator
        }
    }
    lines
}

/// Wraps a single string into lines not exceeding approximate character width.
fn wrap_text(line: &str, max_chars: usize) -> Vec<String> {
    if line.len() <= max_chars {
        return vec![line.to_string()];
    }

    let mut result = Vec::new();
    let mut current_line = String::new();

    for word in line.split_whitespace() {
        if current_line.is_empty() {
            current_line.push_str(word);
        } else if current_line.len() + 1 + word.len() <= max_chars {
            current_line.push(' ');
            current_line.push_str(word);
        } else {
            result.push(current_line);
            current_line = word.to_string();
        }
    }

    if !current_line.is_empty() {
        result.push(current_line);
    }

    result
}

/// Represents a rendered PDF page stream.
struct PageContent {
    commands: String,
}

/// Pure-Rust Native PDF Generator.
#[derive(Debug)]
pub struct NativePdfDocument {
    title: String,
    author: String,
    subtitle: String,
    pages: Vec<String>,
}

impl NativePdfDocument {
    /// Creates a new document from request payload.
    pub fn new(req: &RenderPdfRequest) -> Result<Self, PdfRenderError> {
        let content = req.content.trim();
        if content.is_empty() {
            return Err(PdfRenderError::EmptyContent);
        }

        let title = req
            .title
            .as_deref()
            .unwrap_or("Clio Academic Submission")
            .to_string();
        let author = req.author.as_deref().unwrap_or("Student").to_string();
        let subtitle = req.subtitle.as_deref().unwrap_or("").to_string();

        let raw_lines = extract_lines_from_content(content);
        let mut doc = Self {
            title,
            author,
            subtitle,
            pages: Vec::new(),
        };

        doc.layout_pages(&raw_lines)?;
        Ok(doc)
    }

    fn layout_pages(&mut self, lines: &[String]) -> Result<(), PdfRenderError> {
        // Page geometry (A4 in points: 595.28 x 841.89)
        const PAGE_WIDTH: f64 = 595.28;
        const PAGE_HEIGHT: f64 = 841.89;
        const MARGIN_LEFT: f64 = 54.0; // 0.75 in
        const MARGIN_RIGHT: f64 = 54.0;
        const MARGIN_TOP: f64 = 54.0;
        const MARGIN_BOTTOM: f64 = 54.0;

        let printable_width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // ~487 pt
        let max_chars_per_line = (printable_width / 5.2).floor() as usize; // ~93 chars

        let mut current_page = PageContent {
            commands: String::with_capacity(2048),
        };
        let mut y = PAGE_HEIGHT - MARGIN_TOP;

        // Header on Page 1: Title, Subtitle, Author, Rule
        let mut is_page_one = true;

        let push_new_page =
            |curr: &mut PageContent, pages: &mut Vec<String>| -> Result<(), PdfRenderError> {
                if pages.len() >= MAX_PDF_PAGES {
                    return Err(PdfRenderError::DocumentTooLarge);
                }
                pages.push(std::mem::take(&mut curr.commands));
                Ok(())
            };

        // Render Page 1 Header
        let escaped_title = escape_pdf_string(&self.title);
        let _ = write!(
            current_page.commands,
            "BT\n/F2 18 Tf\n0.12 0.16 0.22 rg\n{MARGIN_LEFT:.2} {y:.2} Td\n({escaped_title}) Tj\nET\n"
        );
        y -= 24.0;

        if !self.subtitle.is_empty() {
            let esc_sub = escape_pdf_string(&self.subtitle);
            let _ = write!(
                current_page.commands,
                "BT\n/F1 11 Tf\n0.35 0.40 0.45 rg\n{MARGIN_LEFT:.2} {y:.2} Td\n({esc_sub}) Tj\nET\n"
            );
            y -= 16.0;
        }

        let esc_author = escape_pdf_string(&format!(
            "Author: {} | Verified by Clio Engine",
            self.author
        ));
        let _ = write!(
            current_page.commands,
            "BT\n/F1 9 Tf\n0.45 0.50 0.55 rg\n{MARGIN_LEFT:.2} {y:.2} Td\n({esc_author}) Tj\nET\n"
        );
        y -= 14.0;

        // Horizontal separator line
        let right_x = PAGE_WIDTH - MARGIN_RIGHT;
        let _ = write!(
            current_page.commands,
            "0.80 0.83 0.88 RG\n1 w\n{MARGIN_LEFT:.2} {y:.2} m\n{right_x:.2} {y:.2} l\nS\n"
        );
        y -= 20.0;

        // Render Body Text Lines
        for line in lines {
            if line.is_empty() {
                // Paragraph gap
                y -= 8.0;
                if y < MARGIN_BOTTOM + 20.0 {
                    push_new_page(&mut current_page, &mut self.pages)?;
                    y = PAGE_HEIGHT - MARGIN_TOP;
                    is_page_one = false;
                }
                continue;
            }

            let wrapped = wrap_text(line, max_chars_per_line);
            for w in wrapped {
                if y < MARGIN_BOTTOM + 20.0 {
                    push_new_page(&mut current_page, &mut self.pages)?;
                    y = PAGE_HEIGHT - MARGIN_TOP;
                    is_page_one = false;
                }

                let esc_w = escape_pdf_string(&w);
                let _ = write!(
                    current_page.commands,
                    "BT\n/F1 10 Tf\n0.15 0.15 0.15 rg\n{MARGIN_LEFT:.2} {y:.2} Td\n({esc_w}) Tj\nET\n"
                );
                y -= 14.0;
            }
        }

        if !current_page.commands.is_empty() || is_page_one {
            push_new_page(&mut current_page, &mut self.pages)?;
        }

        // Add page footer to all pages: "Page X of Y"
        let total_pages = self.pages.len();
        for (page_idx, content) in self.pages.iter_mut().enumerate() {
            let page_num = page_idx + 1;
            let footer = format!("Page {page_num} of {total_pages} - Clio Pure Rust Engine");
            let esc_footer = escape_pdf_string(&footer);
            let footer_y = MARGIN_BOTTOM / 2.0;
            let _ = write!(
                content,
                "BT\n/F1 8 Tf\n0.55 0.60 0.65 rg\n{MARGIN_LEFT:.2} {footer_y:.2} Td\n({esc_footer}) Tj\nET\n"
            );
        }

        Ok(())
    }

    /// Serializes the document into conforming PDF 1.4 binary bytes.
    pub fn build_pdf_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(4096);
        buf.extend_from_slice(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

        let mut offsets: Vec<usize> = Vec::new();
        // 0-th object entry dummy
        offsets.push(0);

        let num_pages = self.pages.len();

        // Object ID layout:
        // 1: Catalog
        // 2: Pages
        // 3: Font F1 (Helvetica)
        // 4: Font F2 (Helvetica-Bold)
        // 5: Info Dict
        // 6 .. 6 + num_pages - 1: Page objects
        // 6 + num_pages .. 6 + 2*num_pages - 1: Content stream objects

        let catalog_id = 1;
        let pages_id = 2;
        let font_f1_id = 3;
        let font_f2_id = 4;
        let info_id = 5;
        let page_base_id = 6;
        let stream_base_id = page_base_id + num_pages;

        // 1. Catalog Object
        offsets.push(buf.len());
        let _ = write!(
            buf,
            "{catalog_id} 0 obj\n<< /Type /Catalog /Pages {pages_id} 0 R >>\nendobj\n"
        );

        // 2. Pages Object
        let mut kids = String::new();
        for i in 0..num_pages {
            let _ = write!(kids, "{} 0 R ", page_base_id + i);
        }
        offsets.push(buf.len());
        let _ = write!(
            buf,
            "{pages_id} 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>\nendobj\n"
        );

        // 3. Font F1 (Helvetica)
        offsets.push(buf.len());
        let _ = write!(
            buf,
            "{font_f1_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n"
        );

        // 4. Font F2 (Helvetica-Bold)
        offsets.push(buf.len());
        let _ = write!(
            buf,
            "{font_f2_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n"
        );

        // 5. Info Dict
        offsets.push(buf.len());
        let esc_title = escape_pdf_string(&self.title);
        let esc_author = escape_pdf_string(&self.author);
        let _ = write!(
            buf,
            "{info_id} 0 obj\n<< /Title ({esc_title}) /Author ({esc_author}) /Creator (Clio Pure Rust Engine) /Producer (Clio Engine 1.0.0) >>\nendobj\n"
        );

        // 6.. Page objects
        for i in 0..num_pages {
            let page_id = page_base_id + i;
            let stream_id = stream_base_id + i;
            offsets.push(buf.len());
            let _ = write!(
                buf,
                "{page_id} 0 obj\n<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595.28 841.89] /Contents {stream_id} 0 R /Resources << /Font << /F1 {font_f1_id} 0 R /F2 {font_f2_id} 0 R >> >> >>\nendobj\n"
            );
        }

        // Stream objects
        for (i, page_stream) in self.pages.iter().enumerate() {
            let stream_id = stream_base_id + i;
            let stream_bytes = page_stream.as_bytes();
            let stream_len = stream_bytes.len();
            offsets.push(buf.len());
            let _ = write!(
                buf,
                "{stream_id} 0 obj\n<< /Length {stream_len} >>\nstream\n"
            );
            buf.extend_from_slice(stream_bytes);
            buf.extend_from_slice(b"\nendstream\nendobj\n");
        }

        // XRef Table (ISO 32000-1 requires exact 20-byte records ending in SP LF)
        let xref_offset = buf.len();
        let total_objects = offsets.len();
        let _ = write!(buf, "xref\n0 {total_objects}\n0000000000 65535 f \n");
        for &off in &offsets[1..] {
            #[expect(
                clippy::write_with_newline,
                reason = "ISO 32000-1 requires exact 20-byte xref records ending in SP LF"
            )]
            let _ = write!(buf, "{off:010} 00000 n \n");
        }

        // Trailer
        let _ = write!(
            buf,
            "trailer\n<< /Size {total_objects} /Root {catalog_id} 0 R /Info {info_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
        );

        buf
    }
}

/// Renders document content to a PDF byte buffer in-process.
pub fn render_pdf(req: &RenderPdfRequest) -> Result<Vec<u8>, PdfRenderError> {
    let doc = NativePdfDocument::new(req)?;
    Ok(doc.build_pdf_bytes())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_pdf_string() {
        assert_eq!(
            escape_pdf_string("Hello (World) \\ test"),
            "Hello \\(World\\) \\\\ test"
        );
        assert_eq!(escape_pdf_string("‘Smart quotes’"), "'Smart quotes'");
        assert_eq!(escape_pdf_string("Café"), "Cafe");
    }

    #[test]
    fn test_empty_content_returns_error() {
        let req = RenderPdfRequest {
            title: Some("Empty".into()),
            content: "   ".into(),
            author: None,
            subtitle: None,
        };
        assert!(render_pdf(&req).is_err());
    }

    #[test]
    fn test_render_valid_pdf_document() {
        let req = RenderPdfRequest {
            title: Some("Industrial Revolution Analysis".into()),
            content: "<p>The Industrial Revolution marked a rapid transformation in manufacturing.</p><p>Steam power and iron production accelerated economic progress.</p>".into(),
            author: Some("Jane Doe".into()),
            subtitle: Some("History 101".into()),
        };

        let pdf_bytes = render_pdf(&req).expect("PDF rendering succeeds");
        assert!(pdf_bytes.starts_with(b"%PDF-1.4\n"));
        assert!(pdf_bytes.ends_with(b"%%EOF\n"));

        let pdf_str = String::from_utf8_lossy(&pdf_bytes);
        assert!(pdf_str.contains("/Title (Industrial Revolution Analysis)"));
        assert!(pdf_str.contains("/Author (Jane Doe)"));
        assert!(pdf_str.contains("/Type /Page"));
        assert!(pdf_str.contains("Clio Pure Rust Engine"));
    }

    #[test]
    fn test_xref_records_are_strictly_20_bytes() {
        let req = RenderPdfRequest {
            title: Some("XRef Compliance".into()),
            content: "<p>Testing ISO 32000-1 20-byte cross-reference entries.</p>".into(),
            author: Some("Validator".into()),
            subtitle: None,
        };

        let pdf_bytes = render_pdf(&req).expect("PDF rendering succeeds");
        let pdf_str = String::from_utf8_lossy(&pdf_bytes);

        let xref_pos = pdf_str.find("\nxref\n").expect("xref section exists") + 1;
        let trailer_pos = pdf_str.find("\ntrailer\n").expect("trailer section exists") + 1;
        let xref_block = pdf_str[xref_pos..trailer_pos].as_bytes();

        // Skip "xref\n" and "0 N\n" header lines
        let first_nl = xref_block.iter().position(|&b| b == b'\n').unwrap();
        let second_nl = xref_block[first_nl + 1..]
            .iter()
            .position(|&b| b == b'\n')
            .unwrap()
            + first_nl
            + 1;
        let records_bytes = &xref_block[second_nl + 1..];

        assert!(
            !records_bytes.is_empty() && records_bytes.len().is_multiple_of(20),
            "xref records byte length ({}) must be a non-zero multiple of 20",
            records_bytes.len()
        );
        for chunk in records_bytes.chunks(20) {
            assert_eq!(chunk.len(), 20);
            assert_eq!(chunk[18], b' ');
            assert_eq!(chunk[19], b'\n');
        }
    }

    #[test]
    fn test_multi_page_pagination() {
        let mut paragraphs = Vec::new();
        for i in 0..150 {
            paragraphs.push(format!("<p>Paragraph {i}: Educational writing sample demonstrating automated multi-page PDF generation in pure Rust.</p>"));
        }
        let req = RenderPdfRequest {
            title: Some("Long Multi-Page Document".into()),
            content: paragraphs.join(""),
            author: Some("Prolific Author".into()),
            subtitle: None,
        };

        let pdf_bytes = render_pdf(&req).expect("Multi-page PDF succeeds");
        let pdf_str = String::from_utf8_lossy(&pdf_bytes);
        assert!(pdf_str.contains("/Count "));
        // Should have at least 2 pages
        assert!(pdf_str.contains("Page 2 of"));
    }

    #[test]
    fn test_document_exceeding_page_ceiling_returns_document_too_large() {
        let mut paragraphs = Vec::new();
        // Generate enough paragraphs to far exceed 100 pages
        for i in 0..4000 {
            paragraphs.push(format!("<p>Paragraph {i}: Exceeding PDF ceiling test line to guarantee exceeding MAX_PDF_PAGES limit.</p>"));
        }
        let req = RenderPdfRequest {
            title: Some("Overly Long Document".into()),
            content: paragraphs.join(""),
            author: Some("Too Long".into()),
            subtitle: None,
        };

        let result = render_pdf(&req);
        assert!(matches!(result, Err(PdfRenderError::DocumentTooLarge)));
    }

    #[test]
    fn test_extract_lines_from_headings_and_blocks() {
        let html = "<h4>Subheading</h4><p>First paragraph.</p><blockquote>A notable quote</blockquote><tr><td>Cell 1</td><td>Cell 2</td></tr>";
        let lines = extract_lines_from_content(html);
        assert!(lines.contains(&"Subheading".to_string()));
        assert!(lines.contains(&"First paragraph.".to_string()));
        assert!(lines.contains(&"A notable quote".to_string()));
    }
}
