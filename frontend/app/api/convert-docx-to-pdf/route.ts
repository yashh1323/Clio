import mammoth from 'mammoth'
import puppeteer from 'puppeteer'
import sanitizeHtml from 'sanitize-html'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { renderPdfWithEngine } from '@/lib/engine'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

export async function POST(req: NextRequest) {
  // Auth check — only logged-in users can convert files
  const token = req.cookies.get('clio_session')?.value
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const session = verifyToken(token)
  if (!session) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  // Pre-check Content-Length to reject oversized payloads early (allow 1MB buffer for multipart headers)
  const contentLength = req.headers.get('content-length')
  if (contentLength) {
    const cl = parseInt(contentLength, 10)
    if (isNaN(cl) || cl > MAX_FILE_SIZE + 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 25MB limit' }, { status: 413 })
    }
  }

  try {
    console.log('Starting PDF conversion...')
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) {
      console.error('No file uploaded')
      return NextResponse.json({ error: 'missing_file' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 25MB limit' }, { status: 413 })
    }

    console.log('File received:', file.name, file.size)
    const ab = await file.arrayBuffer()
    const buffer = Buffer.from(ab)

    console.log('Converting DOCX to HTML...')
    const result = await mammoth.convertToHtml({ buffer }, {
      convertImage: (mammoth as any).images.inline(
        async (element: { read: (enc?: 'base64') => Promise<string>; contentType: string }) => {
          const imageBuffer = await element.read('base64')
          const src = `data:${element.contentType};base64,${imageBuffer}`
          return { src }
        }
      ) as any,
    })
    console.log('HTML conversion complete. Length:', result.value.length)

    // Sanitize HTML from mammoth allowing only typography tags, tables, and data URIs for images
    const sanitizedBody = sanitizeHtml(result.value, {
      allowedTags: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'b', 'i', 'strong', 'em',
        'u', 's', 'strike', 'ul', 'ol', 'li', 'blockquote', 'sub', 'sup',
        'table', 'tbody', 'thead', 'tr', 'th', 'td', 'br', 'hr', 'img'
      ],
      allowedAttributes: {
        '*': ['style', 'class'],
        img: ['src', 'alt', 'width', 'height'],
      },
      allowedSchemes: ['data'],
      allowedSchemesByTag: {
        img: ['data'],
      },
      allowedStyles: {
        '*': {
          'color': [/^\#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba\(/i, /^[a-zA-Z]+$/i],
          'background-color': [/^\#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba\(/i, /^[a-zA-Z]+$/i],
          'text-align': [/^(left|right|center|justify)$/i],
          'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%)$/i],
          'font-weight': [/^\d+$/i, /^(bold|normal|bolder|lighter)$/i],
          'font-style': [/^(italic|normal|oblique)$/i],
          'text-decoration': [/^(underline|line-through|none)$/i],
          'margin': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm)(?:\s+\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm))*$/i],
          'padding': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm)(?:\s+\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm))*$/i],
          'line-height': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%)?$/i],
        },
      },
    })

    const inName = (file as File).name || 'document.docx'
    // Sanitize filename to prevent header injection
    const base = inName.replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9.\-_ ()]/g, '_') || 'document'

    // ── High-Performance Rust Engine PDF Rendering (Strangler Fig) ──
    const enginePdf = await renderPdfWithEngine(
      sanitizedBody,
      base,
      session.username
    )
    if (enginePdf) {
      console.log('PDF rendered via high-performance Rust Engine')
      return new Response(Buffer.from(enginePdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${base}.pdf"`,
        },
      })
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 20mm; }
      img { max-width: 100%; height: auto; }
      p { line-height: 1.5; font-size: 12pt; }
      h1, h2, h3, h4, h5, h6 { margin: 0 0 8pt; }
    </style></head><body>${sanitizedBody}</body></html>`

    console.log('Launching Puppeteer...')
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    })
    console.log('Puppeteer launched. Opening page...')
    try {
      const page = await browser.newPage()
      // Disable JavaScript execution completely to prevent XSS / local execution
      await page.setJavaScriptEnabled(false)

      // Block all outbound network, private IP ranges, and file requests (SSRF defense)
      await page.setRequestInterception(true)
      page.on('request', (interceptedRequest) => {
        const resourceType = interceptedRequest.resourceType()
        const url = interceptedRequest.url().toLowerCase()

        // 1. Explicitly block all network schemes and local file schemes
        if (
          url.startsWith('http:') ||
          url.startsWith('https:') ||
          url.startsWith('file:') ||
          url.startsWith('ftp:') ||
          url.startsWith('ws:') ||
          url.startsWith('wss:') ||
          url.startsWith('javascript:')
        ) {
          interceptedRequest.abort().catch(() => {})
          return
        }

        // 2. Allow local document rendering (about:blank or data:text/html)
        if (resourceType === 'document' && (url === 'about:blank' || url.startsWith('data:'))) {
          interceptedRequest.continue().catch(() => {})
          return
        }

        // 3. Allow safe inline data URIs (images and inline styles)
        if (url.startsWith('data:image/') || url.startsWith('data:text/css') || url.startsWith('data:font/')) {
          interceptedRequest.continue().catch(() => {})
          return
        }

        // 4. Abort any other request
        interceptedRequest.abort().catch(() => {})
      })

      console.log('Page opened. Setting content...')
      // Use 'load' instead of 'networkidle0' for faster/safer static content rendering
      await page.setContent(html, { waitUntil: 'load', timeout: 60000 })
      console.log('Content set. Generating PDF...')
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
        timeout: 60000
      })
      console.log('PDF generated. Size:', pdfBuffer.byteLength)
      const arrayBuffer = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength) as ArrayBuffer
      return new NextResponse(arrayBuffer, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${base}.pdf"` } })
    } finally {
      console.log('Closing browser...')
      await browser.close()
    }
  } catch (error) {
    console.error('Detailed PDF Error:', error)
    return NextResponse.json({ error: 'conversion_failed' }, { status: 500 })
  }
}
