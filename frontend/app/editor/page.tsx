"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Modal } from "../../components/ui/modal"
import { Button } from "../../components/ui/button"
import { Loader2, CheckCircle, AlertTriangle, Download, Save, GraduationCap, BookOpen, Clock, ChevronDown, ChevronUp, AlertCircle } from "lucide-react"
import { saveAs } from "file-saver"
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from "docx"
import RichEditor from "../../components/editor/RichEditor"
import { type ReplaySnapshot } from "../../components/editor/ReplayTimeline"
import SpotifyCard from "../../components/ui/spotify-card"
import { saveToDB, getFromDB, removeFromDB } from "../../lib/db"
import { ThemeToggle } from "../../components/ui/theme-toggle"
import { WebGLShader } from "../../components/ui/web-gl-shader"

function EditorPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  // content starts as string, but can be set to JSON object for initialization
  const [content, setContent] = useState<any>("")
  const [html, setHtml] = useState("")
  const [json, setJson] = useState<object | null>(null)
  const [wpm, setWpm] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [pasteCount, setPasteCount] = useState(0)
  const [status, setStatus] = useState<"verified" | "warning" | "suspicious">("verified")
  const [title, setTitle] = useState("Philosophy 101")
  const [subtitle, setSubtitle] = useState("Mid-Term Essay")
  const [subtitleEnabled, _setSubtitleEnabled] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedTeacher, setSelectedTeacher] = useState("")
  const [teachers, setTeachers] = useState<{ id: string; username: string }[]>([])
  const [assignments, setAssignments] = useState<{ id: string; title: string; description: string; due_date: string | null; max_word_count: number | null; teacher_id?: string | null }[]>([])
  const [selectedAssignment, setSelectedAssignment] = useState("")
  const [showInstructions, setShowInstructions] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [lastDocxUrl, setLastDocxUrl] = useState<string | null>(null)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lastDocxName, setLastDocxName] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lastPdfName, setLastPdfName] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [docxStatus, setDocxStatus] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const [replaySnapshots, setReplaySnapshots] = useState<ReplaySnapshot[]>([])
  const [modalState, setModalState] = useState<{
    isOpen: boolean
    type: "confirm" | "success" | "error" | "loading"
    title: string
    message: string
    onConfirm?: () => void
  }>({
    isOpen: false,
    type: "confirm",
    title: "",
    message: ""
  })

  const lastTypingAtRef = useRef<number | null>(null)
  const lastTypingLenRef = useRef(0)
  const lastRawSnapshotTimeRef = useRef<number | null>(null)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTypingMsRef = useRef(0)   // total milliseconds of active typing
  const IDLE_THRESHOLD_MS = 5000        // gaps longer than 5s are considered idle

  // Load initial editor data: either from cloud draft (?draft=<id>) or local IndexedDB fallback
  useEffect(() => {
    let cancelled = false

    async function initializeEditor() {
      setIsLoaded(false)
      const draftId = searchParams.get("draft")

      if (draftId) {
        try {
          const res = await fetch(`/api/drafts?id=${draftId}`, { credentials: "include" })
          if (res.ok) {
            const draft = await res.json()
            if (!cancelled && draft) {
              setActiveDraftId(draft.id)
              if (draft.title) setTitle(draft.title)
              if (draft.assignment_id) setSelectedAssignment(draft.assignment_id)
              if (draft.json_content && typeof draft.json_content === "object" && Object.keys(draft.json_content).length > 0) {
                setContent(draft.json_content)
                setJson(draft.json_content)
              } else if (draft.html) {
                setContent(draft.html)
                setHtml(draft.html)
              } else if (draft.content) {
                setContent(draft.content)
              }
              if (draft.html) {
                setHtml(draft.html)
              }
              setIsLoaded(true)
              return
            }
          } else {
            console.error("Failed to load draft:", res.status)
          }
        } catch (err) {
          console.error("Error loading draft:", err)
        }
      }

      // Fallback: Load persistence data from IndexedDB / localStorage
      try {
        const savedJson = await getFromDB("clio_json")
        const savedHtml = await getFromDB("clio_html")
        const savedContent = await getFromDB("clio_content")

        const savedTitle = localStorage.getItem("clio_title")
        const savedSubtitle = localStorage.getItem("clio_subtitle")
        const savedWpm = localStorage.getItem("clio_wpm")
        const savedPasteCount = localStorage.getItem("clio_pasteCount")

        if (!cancelled) {
          setActiveDraftId(null)
          // Prioritize JSON, then HTML, then Text
          if (savedJson) {
            setContent(savedJson)
            setJson(savedJson)
          } else if (savedHtml) {
            setContent(savedHtml)
            setHtml(savedHtml)
          } else if (savedContent) {
            setContent(savedContent)
          }

          if (savedHtml) setHtml(savedHtml)
          if (savedTitle) setTitle(savedTitle)
          if (savedSubtitle) setSubtitle(savedSubtitle)
          if (savedWpm) setWpm(parseInt(savedWpm))
          if (savedPasteCount) setPasteCount(parseInt(savedPasteCount))
        }
      } catch (err) {
        console.error("Error loading saved state:", err)
      } finally {
        if (!cancelled) {
          setIsLoaded(true)
        }
      }
    }

    const timeout = setTimeout(() => {
      if (!cancelled) setIsLoaded(true)
    }, 5000)

    initializeEditor().finally(() => clearTimeout(timeout))

    // Load replay snapshots
    getFromDB("clio_replay_snapshots").then((saved) => {
      if (!cancelled && saved && Array.isArray(saved)) setReplaySnapshots(saved)
    }).catch(() => { })

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [searchParams])

  // Fetch available teachers and assignments on mount
  useEffect(() => {
    async function loadTeachers() {
      try {
        const res = await fetch("/api/teachers", { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          setTeachers(data)
        }
      } catch (err) {
        console.error("Failed to load teachers:", err)
      }
    }
    async function loadAssignments() {
      try {
        const res = await fetch("/api/assignments", { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          setAssignments(data)
        }
      } catch (err) {
        console.error("Failed to load assignments:", err)
      }
    }
    loadTeachers()
    loadAssignments()
  }, [])

  // Synchronize teacher binding when assignment changes or assignments load
  useEffect(() => {
    if (selectedAssignment && assignments.length > 0) {
      const a = assignments.find(a => a.id === selectedAssignment)
      if (a?.teacher_id) {
        setSelectedTeacher(a.teacher_id)
      }
    }
  }, [selectedAssignment, assignments])

  // Auth + Role Check — only students can access the editor
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" })
        if (!res.ok) {
          router.push("/login")
          return
        }
        const data = await res.json()
        if (data.role !== "student") {
          router.push("/dashboard")
        }
      } catch {
        router.push("/login")
      }
    }
    checkAuth()
  }, [router])

  // Auto-save logic
  useEffect(() => {
    if (!isLoaded) return
    setIsSaving(true)

    const saveData = async () => {
      try {
        if (json) await saveToDB("clio_json", json)
        await saveToDB("clio_html", html)
        // Only save content as text if it's a string (avoid saving the JSON object as 'content')
        if (typeof content === 'string') {
          await saveToDB("clio_content", content)
        }

        localStorage.setItem("clio_title", title)
        localStorage.setItem("clio_subtitle", subtitle)
        localStorage.setItem("clio_wpm", wpm.toString())
        localStorage.setItem("clio_pasteCount", pasteCount.toString())

        if (activeDraftId) {
          const textToCount = typeof content === 'string' ? content : html
          const wordCount = textToCount.trim().split(/\s+/).filter(Boolean).length
          fetch("/api/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              id: activeDraftId,
              title,
              content: typeof content === 'string' ? content : html,
              html,
              json_content: json || {},
              word_count: wordCount,
              assignment_id: selectedAssignment || undefined,
            }),
          }).catch(() => {})
        }
      } catch (err) {
        console.error("Error auto-saving state:", err)
      } finally {
        setIsSaving(false)
      }
    }

    const timeoutId = setTimeout(saveData, 1000)
    return () => clearTimeout(timeoutId)
  }, [content, html, json, title, subtitle, wpm, pasteCount, isLoaded, activeDraftId, selectedAssignment])

  // Analytics Logic
  // WPM is updated in onChange to avoid render loops

  const resetStatusAfterDelay = (next: "warning" | "suspicious") => {
    setStatus(next)
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current)
    }
    statusTimeoutRef.current = setTimeout(() => setStatus("verified"), 10000)
  }
  const handlePaste = () => {
    setPasteCount(prev => prev + 1)
    resetStatusAfterDelay("warning")
  }

  const getImageData = async (src: string): Promise<{ buffer: ArrayBuffer, mime: string } | null> => {
    try {
      if (!src) return null
      if (src.startsWith('data:')) {
        const parts = src.split(',')
        const mime = parts[0].split(':')[1].split(';')[0]
        const base64 = parts[1]
        if (!base64) return null
        const binaryString = window.atob(base64)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        return { buffer: bytes.buffer, mime }
      }
      const resp = await fetch(src, { mode: 'cors' })
      if (!resp.ok) return null
      const mime = resp.headers.get('content-type') || 'image/jpeg'
      const buffer = await resp.arrayBuffer()
      return { buffer, mime }
    } catch (e) {
      console.error("Error fetching image data:", e)
      return null
    }
  }

  const handleExportDocx = async () => {
    try {
      setIsExporting(true)
      const { blob, fileName } = await buildDocxFromState()
      saveAs(blob, `${fileName}.docx`)
      if (lastDocxUrl) URL.revokeObjectURL(lastDocxUrl)
      const docxUrl = URL.createObjectURL(blob)
      setLastDocxUrl(docxUrl)
      setLastDocxName(fileName)
      setDocxStatus('DOCX Generated Successfully')
    } catch (e) {
      console.error(e)
      alert("Could not export DOCX. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportPdf = async () => {
    try {
      setIsExporting(true)
      setPdfStatus(null)

      const sub = subtitleEnabled && subtitle.trim() ? ` (${subtitle.trim()})` : ''
      const fileName = (`${title || 'essay'}${sub}`).trim().replace(/[^a-z0-9\- _().]/gi, '_') || 'essay'

      // Get the live editor HTML
      let editorHtmlContent = html
      const editorEl = document.querySelector('#editor-export-root .ProseMirror')
      if (editorEl) {
        editorHtmlContent = editorEl.innerHTML
      }

      if (!editorHtmlContent) {
        alert('No content to export.')
        return
      }

      // Dynamically import jspdf (client-side only)
      const { default: jsPDF } = await import('jspdf')

      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 20
      const maxWidth = pageWidth - (margin * 2)
      let yPosition = margin

      // Helper to check if we need a new page
      const checkPageBreak = (neededHeight: number) => {
        if (yPosition + neededHeight > pageHeight - margin) {
          pdf.addPage()
          yPosition = margin
        }
      }

      // Add title
      pdf.setFontSize(18)
      pdf.setFont('helvetica', 'bold')
      const titleLines = pdf.splitTextToSize(title || 'Essay', maxWidth)
      checkPageBreak(titleLines.length * 7)
      pdf.text(titleLines, margin, yPosition)
      yPosition += titleLines.length * 7 + 4

      // Add subtitle
      if (subtitleEnabled && subtitle) {
        pdf.setFontSize(14)
        pdf.setFont('helvetica', 'normal')
        const subtitleLines = pdf.splitTextToSize(subtitle, maxWidth)
        checkPageBreak(subtitleLines.length * 6)
        pdf.text(subtitleLines, margin, yPosition)
        yPosition += subtitleLines.length * 6 + 8
      }

      // Parse the editor content
      const parser = new DOMParser()
      const doc = parser.parseFromString(editorHtmlContent, 'text/html')

      // Process all content nodes
      const processNode = async (node: Node, indentOffset = 0) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim()
          if (text) {
            pdf.setFontSize(12)
            pdf.setFont('helvetica', 'normal')
            const lines = pdf.splitTextToSize(text, maxWidth - indentOffset)
            checkPageBreak(lines.length * 5)
            pdf.text(lines, margin + indentOffset, yPosition)
            yPosition += lines.length * 5
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement
          const tagName = el.tagName.toLowerCase()

          if (tagName === 'img') {
            const src = el.getAttribute('src')
            if (src) {
              try {
                // Extract image dimensions
                // Smart dimension parsing for PDF (mm)
                // 1px = 0.264583 mm
                const parsePdfDim = (val: string | null, maxMm: number): number => {
                  if (!val) return 0
                  if (val.trim().endsWith('%')) {
                    return (parseFloat(val) / 100) * maxMm
                  }
                  // Assume px if no unit or px unit
                  return (parseFloat(val) || 0) * 0.264583
                }

                let imgWidth = parsePdfDim(el.getAttribute('width'), maxWidth)
                let imgHeight = parsePdfDim(el.getAttribute('height'), pageHeight)

                // Use natural dimensions for aspect ratio if explicit sizes are missing
                // Load image to get real natural dimensions (DOMParser elements don't load resources)
                let natW = 600
                let natH = 400
                try {
                  const img = new Image()
                  img.src = src
                  await new Promise<void>((resolve) => {
                    if (img.complete) resolve()
                    else {
                      img.onload = () => resolve()
                      img.onerror = () => resolve()
                    }
                  })
                  if (img.naturalWidth > 0) {
                    natW = img.naturalWidth
                    natH = img.naturalHeight
                  }
                } catch (e) {
                  console.warn("Failed to load image dimensions", e)
                }
                const ratio = natH / natW

                if (!imgWidth && !imgHeight) {
                  // No attributes? Use natural size (converted to mm)
                  imgWidth = natW * 0.264583
                  imgHeight = natH * 0.264583
                } else if (imgWidth && !imgHeight) {
                  // Width set, calc height
                  imgHeight = imgWidth * ratio
                } else if (!imgWidth && imgHeight) {
                  // Height set, calc width
                  imgWidth = imgHeight / ratio
                }

                // Calculate scaled dimensions to fit page
                // Dimensions are now already in mm

                // Scale down if too wide
                if (imgWidth > maxWidth - indentOffset) {
                  const scale = (maxWidth - indentOffset) / imgWidth
                  imgWidth = maxWidth - indentOffset
                  imgHeight = imgHeight * scale
                }

                // Scale down if too tall for page
                if (imgHeight > pageHeight - margin * 2) {
                  const scale = (pageHeight - margin * 2) / imgHeight
                  imgHeight = pageHeight - margin * 2
                  imgWidth = imgWidth * scale
                }

                // Load image data for embedding
                const imgData = await getImageData(src)
                if (imgData) {
                  let format = 'JPEG'
                  if (imgData.mime.toLowerCase().includes('png')) format = 'PNG'
                  else if (imgData.mime.toLowerCase().includes('webp')) format = 'WEBP'

                  pdf.addImage(new Uint8Array(imgData.buffer), format, margin, yPosition, imgWidth, imgHeight)
                  yPosition += imgHeight + 5
                  console.log('[PDF Export] Added image to PDF, dimensions:', imgWidth, 'x', imgHeight, 'Format:', format)
                }
              } catch (err) {
                console.error('[PDF Export] Failed to add image:', err)
              }
            }
          } else if (tagName === 'li') {
            // Collect text content for the list item itself (excluding nested lists)
            let liText = ''
            const collectText = (n: Node) => {
              if (n.nodeType === Node.TEXT_NODE) liText += n.textContent
              else if (n.nodeType === Node.ELEMENT_NODE) {
                const t = (n as HTMLElement).tagName.toLowerCase()
                if (t !== 'ul' && t !== 'ol') {
                  n.childNodes.forEach(collectText)
                }
              }
            }
            collectText(el)
            const text = liText.trim()

            if (text) {
              const parentTag = el.parentElement?.tagName.toLowerCase()
              const isOrdered = parentTag === 'ol' // Simplified check

              // For nested lists, we might want to know our index in the parent
              const index = Array.from(el.parentElement?.children || []).filter(c => c.tagName.toLowerCase() === 'li').indexOf(el) + 1
              const bullet = isOrdered ? `${index}.` : '•'

              pdf.setFontSize(12)
              pdf.setFont('helvetica', 'normal')

              // Indent list content
              const bulletX = margin + indentOffset
              const textX = margin + indentOffset + 6
              const textMaxWidth = maxWidth - indentOffset - 6

              const lines = pdf.splitTextToSize(text, textMaxWidth)
              checkPageBreak(lines.length * 5 + 2)

              // Draw bullet/number
              pdf.text(bullet, bulletX, yPosition)
              // Draw text indented
              pdf.text(lines, textX, yPosition)

              yPosition += lines.length * 5 + 2
            }

            // Recursively process nested lists (ul/ol)
            for (const child of Array.from(el.children)) {
              const t = child.tagName.toLowerCase()
              if (t === 'ul' || t === 'ol') {
                await processNode(child, indentOffset + 8)
              }
            }
          } else if (tagName === 'p') {
            const text = el.textContent?.trim()
            if (text) {
              pdf.setFontSize(12)
              pdf.setFont('helvetica', 'normal')
              const lines = pdf.splitTextToSize(text, maxWidth - indentOffset)
              checkPageBreak(lines.length * 5 + 3)
              pdf.text(lines, margin + indentOffset, yPosition)
              yPosition += lines.length * 5 + 3
            }
          } else if (tagName.match(/^h[1-6]$/)) {
            const level = parseInt(tagName[1])
            const text = el.textContent?.trim()
            if (text) {
              const fontSize = 18 - (level * 2)
              pdf.setFontSize(fontSize)
              pdf.setFont('helvetica', 'bold')
              const lines = pdf.splitTextToSize(text, maxWidth)
              checkPageBreak(lines.length * (fontSize * 0.4) + 4)
              pdf.text(lines, margin, yPosition)
              yPosition += lines.length * (fontSize * 0.4) + 4
            }
          } else {
            // Recurse into child nodes for other containers
            for (const child of Array.from(el.childNodes)) {
              await processNode(child, indentOffset)
            }
          }
        }
      }

      // Process all body children
      console.log('[PDF Export] Processing document nodes...')
      for (const child of Array.from(doc.body.childNodes)) {
        await processNode(child)
      }

      const pdfBlob = pdf.output('blob')
      saveAs(pdfBlob, `${fileName}.pdf`)

      if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl)
      const pdfUrl = URL.createObjectURL(pdfBlob)
      setLastPdfUrl(pdfUrl)
      setLastPdfName(fileName)
      setPdfStatus('PDF Generated Successfully')
      console.log('[PDF Export] PDF generated successfully')
    } catch (e) {
      console.error('PDF Export Error:', e)
      alert('Could not export PDF. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Recursively collect all <img> elements from any depth in a DOM subtree
  const collectAllImages = (el: HTMLElement): HTMLImageElement[] => {
    const imgs: HTMLImageElement[] = []
    if (el.tagName.toLowerCase() === 'img') {
      imgs.push(el as HTMLImageElement)
    }
    for (const child of Array.from(el.children)) {
      imgs.push(...collectAllImages(child as HTMLElement))
    }
    return imgs
  }

  // Build an ImageRun from an <img> element
  const buildImageRun = async (imgEl: HTMLElement): Promise<ImageRun | null> => {
    const src = imgEl.getAttribute('src')
    if (!src) return null
    const imgData = await getImageData(src)
    if (!imgData) return null
    const buf = imgData.buffer
    const rawW = imgEl.getAttribute('width')
    const rawH = imgEl.getAttribute('height')
    let w = 600
    let h = 400

    // Smart parsing for DOCX (pixels)
    if (rawW) {
      if (rawW.endsWith('%')) w = 600 * (parseFloat(rawW) / 100)
      else w = parseFloat(rawW) || 600
    }
    if (rawH) {
      if (rawH.endsWith('%')) h = 400 * (parseFloat(rawH) / 100)
      else h = parseFloat(rawH) || 400
    }
    return new ImageRun({ data: new Uint8Array(buf), transformation: { width: w, height: h } } as any)
  }

  // Process inline children (text, bold, italic, images — recursively) into runs
  const processInlineChildren = async (el: HTMLElement): Promise<(TextRun | ImageRun)[]> => {
    const runs: (TextRun | ImageRun)[] = []
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent
        if (text && text.trim()) runs.push(new TextRun(text))
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const cEl = child as HTMLElement
        const cTag = cEl.tagName.toLowerCase()
        if (cTag === 'strong' || cTag === 'b') {
          runs.push(new TextRun({ text: cEl.textContent || '', bold: true }))
        } else if (cTag === 'em' || cTag === 'i') {
          runs.push(new TextRun({ text: cEl.textContent || '', italics: true }))
        } else if (cTag === 'br') {
          runs.push(new TextRun({ text: '\n' }))
        } else if (cTag === 'img') {
          const imgRun = await buildImageRun(cEl)
          if (imgRun) runs.push(imgRun)
        } else {
          // Recurse into spans, divs, or any other inline wrapper
          const nestedImgs = collectAllImages(cEl)
          if (nestedImgs.length > 0) {
            for (const img of nestedImgs) {
              const imgRun = await buildImageRun(img)
              if (imgRun) runs.push(imgRun)
            }
          } else if (cEl.textContent?.trim()) {
            runs.push(new TextRun(cEl.textContent || ''))
          }
        }
      }
    }
    return runs
  }

  async function buildDocxFromState(): Promise<{ blob: Blob; fileName: string }> {
    const sub = subtitleEnabled && subtitle.trim() ? ` (${subtitle.trim()})` : ''
    const fileName = (`${title || 'essay'}${sub}`).trim().replace(/[^a-z0-9\- _().]/gi, '_') || 'essay'

    // Get HTML from the LIVE editor DOM — this is the most reliable source.
    // The `html` React state can be stale or empty (e.g. when JSON was restored on mount
    // but no user edit has triggered `onUpdate` yet).
    let exportHtml = html
    const editorEl = document.querySelector('#editor-export-root .ProseMirror')
    if (editorEl) {
      exportHtml = editorEl.innerHTML
      console.log('[DOCX Export] Using live editor DOM innerHTML, length:', exportHtml.length)
    } else {
      console.log('[DOCX Export] Editor element not found, using html state, length:', exportHtml?.length || 0)
    }

    console.log('[DOCX Export] html preview:', exportHtml?.substring(0, 300))

    if (!exportHtml) {
      console.warn('[DOCX Export] No HTML available, falling back to text content')
      const textContent = typeof content === 'string' ? content : "Essay Content"
      const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(textContent)] })] }] })
      return { blob: await Packer.toBlob(doc), fileName }
    }
    const parser = new DOMParser()
    const docHtml = parser.parseFromString(exportHtml, 'text/html')

    // Debug: count all images in the parsed HTML
    const allImgs = docHtml.querySelectorAll('img')
    console.log('[DOCX Export] Found', allImgs.length, 'img tags in parsed HTML')
    allImgs.forEach((img, i) => {
      console.log(`[DOCX Export] img[${i}] src:`, img.getAttribute('src')?.substring(0, 80), 'width:', img.getAttribute('width'), 'height:', img.getAttribute('height'))
    })

    // Debug: log top-level children
    console.log('[DOCX Export] Top-level body children:', Array.from(docHtml.body.childNodes).map(n => (n as HTMLElement).tagName || n.nodeType))

    const createParagraph = async (el: HTMLElement): Promise<Paragraph | null> => {
      const tagName = el.tagName.toLowerCase()
      if (tagName.match(/^h[1-6]$/)) {
        const level = parseInt(tagName[1])
        return new Paragraph({
          text: el.textContent || '',
          heading:
            level === 2
              ? HeadingLevel.HEADING_2
              : level === 3
                ? HeadingLevel.HEADING_3
                : HeadingLevel.HEADING_1,
        })
      }
      if (tagName === 'p' || tagName === 'li') {
        const runs = await processInlineChildren(el)
        const opts: any = { children: runs }
        if (tagName === 'li') opts.bullet = { level: 0 }
        return new Paragraph(opts)
      }
      if (tagName === 'img') {
        const imgRun = await buildImageRun(el)
        if (imgRun) return new Paragraph({ children: [imgRun] })
      }
      // For any <div> — check if it contains images (Tiptap NodeView wrappers)
      if (tagName === 'div') {
        const imgs = collectAllImages(el)
        if (imgs.length > 0) {
          // Image wrapper div — emit each image as its own paragraph
          const imgRuns: ImageRun[] = []
          for (const img of imgs) {
            const imgRun = await buildImageRun(img)
            if (imgRun) imgRuns.push(imgRun)
          }
          if (imgRuns.length > 0) {
            return new Paragraph({ children: imgRuns })
          }
        }
        // Regular div with text content — process inline children
        const runs = await processInlineChildren(el)
        if (runs.length > 0) {
          return new Paragraph({ children: runs })
        }
      }
      return null
    }

    const processNodes = async (nodes: NodeListOf<ChildNode>): Promise<Paragraph[]> => {
      const paragraphs: Paragraph[] = []
      for (const node of Array.from(nodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as HTMLElement
        const tagName = el.tagName.toLowerCase()
        if (tagName === 'ul' || tagName === 'ol') {
          paragraphs.push(...await processNodes(el.childNodes))
        } else {
          const p = await createParagraph(el)
          if (p) {
            paragraphs.push(p)
          } else {
            // If createParagraph returned null for a container, recurse into children
            // This handles deeply nested Tiptap NodeView wrappers
            if (el.children.length > 0) {
              paragraphs.push(...await processNodes(el.childNodes))
            }
          }
        }
      }
      return paragraphs
    }

    const children: Paragraph[] = []
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }))
    if (subtitleEnabled && subtitle) {
      children.push(new Paragraph({ text: subtitle, heading: HeadingLevel.HEADING_2 }))
    }
    children.push(...await processNodes(docHtml.body.childNodes))
    const doc = new Document({ sections: [{ children }] })
    return { blob: await Packer.toBlob(doc), fileName }
  }

  const handleLogout = async () => {
    try {
      // Clear server-side session cookie
      await fetch("/api/auth/logout", { method: "POST" })
      if (typeof window !== "undefined") {
        localStorage.removeItem("spotify_token")
        localStorage.removeItem("clio_auth")
        sessionStorage.removeItem("spotify_code_verifier")
      }
    } catch { }
    router.push("/login")
  }

  const handleConfirmSubmit = async () => {
    setModalState(prev => ({ ...prev, type: "loading", title: "Submitting...", message: "Please wait while we submit your essay." }))

    try {
      const assignmentObj = assignments.find(a => a.id === selectedAssignment)
      // Use html if available, fall back to string content
      const essayContent = html && html.trim().length > 0
        ? html
        : (typeof content === 'string' ? content : '')

      // ── Subsample heavy HTML markup while preserving all verification metadata intact ──
      // Preserve lightweight verification metadata { timestamp, textLength } intact for verification auditing,
      // subsampling only the heavy HTML markup for replay storage (at most MAX_HTML_SNAPSHOTS).
      const MAX_SNAPSHOTS = 10_000
      const MAX_HTML_SNAPSHOTS = 200
      const MAX_HTML_LENGTH = 50_000

      const cappedSnapshots = replaySnapshots.slice(0, MAX_SNAPSHOTS)
      const htmlIndices = new Set<number>()
      if (cappedSnapshots.length <= MAX_HTML_SNAPSHOTS) {
        for (let i = 0; i < cappedSnapshots.length; i++) {
          htmlIndices.add(i)
        }
      } else {
        for (let i = 0; i < MAX_HTML_SNAPSHOTS - 1; i++) {
          htmlIndices.add(Math.floor((i * (cappedSnapshots.length - 1)) / (MAX_HTML_SNAPSHOTS - 1)))
        }
        htmlIndices.add(0)
        htmlIndices.add(cappedSnapshots.length - 1)
      }

      const auditSnapshots = cappedSnapshots.map((snap, idx) => {
        if (!htmlIndices.has(idx)) {
          return {
            timestamp: snap.timestamp,
            textLength: snap.textLength,
            html: "",
          }
        }

        const cleanHtml = snap.html ? snap.html.replace(/src="data:image\/[^;]+;base64,[^"]+"/g, 'src="" class="placeholder-image"') : ""
        return {
          timestamp: snap.timestamp,
          textLength: snap.textLength,
          html: cleanHtml.length > MAX_HTML_LENGTH ? cleanHtml.slice(0, MAX_HTML_LENGTH) : cleanHtml,
        }
      })

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_title: assignmentObj ? assignmentObj.title : (title || "Untitled"),
          assignment_id: selectedAssignment || undefined,
          content: essayContent,
          replay_snapshots: auditSnapshots,
          wpm,
          paste_count: pasteCount,
          teacher_id: selectedTeacher || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setModalState({
          isOpen: true,
          type: "error",
          title: "Submission Failed",
          message: data.error || "Unknown error"
        })
        return
      }

      // Clear local persistence
      await removeFromDB("clio_json")
      await removeFromDB("clio_html")
      await removeFromDB("clio_content")
      await removeFromDB("clio_replay_snapshots")
      localStorage.removeItem("clio_title")
      localStorage.removeItem("clio_subtitle")
      localStorage.removeItem("clio_wpm")
      localStorage.removeItem("clio_pasteCount")

      if (activeDraftId) {
        await fetch(`/api/drafts?id=${activeDraftId}`, { method: "DELETE", credentials: "include" }).catch(() => {})
        setActiveDraftId(null)
      }

      setModalState({
        isOpen: true,
        type: "success",
        title: "Submission Successful",
        message: `✅ Essay submitted successfully!\nIntegrity Score: ${data.score}/100`
      })

      setContent("")
      setHtml("")
      setJson(null)
    } catch (err: any) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Submission Error",
        message: err.message || "An unexpected error occurred."
      })
    }
  }

  const handleSubmit = async () => {
    // Use html if available, otherwise fall back to content (string form)
    const essayContent = html && html.trim().length > 0
      ? html
      : (typeof content === 'string' ? content : '')

    if (!essayContent || essayContent.trim().length === 0) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Empty Essay",
        message: "Please write something before submitting."
      })
      return
    }
    if (!selectedTeacher && !selectedAssignment) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "No Teacher Selected",
        message: "Please select a teacher or assignment to submit your essay to."
      })
      return
    }
    setModalState({
      isOpen: true,
      type: "confirm",
      title: "Confirm Submission",
      message: "Are you sure you want to submit? This will send your essay for review.",
      onConfirm: handleConfirmSubmit
    })
  }


  // ── Keyboard Shortcuts ──
  const handleSaveDraft = useCallback(async () => {
    setIsSaving(true)
    try {
      if (json) await saveToDB("clio_json", json)
      await saveToDB("clio_html", html)
      await saveToDB("clio_content", typeof content === 'string' ? content : '')
      localStorage.setItem("clio_title", title)
      localStorage.setItem("clio_subtitle", subtitle)
      localStorage.setItem("clio_wpm", String(wpm))
      localStorage.setItem("clio_pasteCount", String(pasteCount))

      if (activeDraftId) {
        await fetch("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            id: activeDraftId,
            title,
            content: typeof content === 'string' ? content : html,
            html,
            json_content: json || {},
            word_count: (typeof content === 'string' ? content : html).trim().split(/\s+/).filter(Boolean).length,
            assignment_id: selectedAssignment || undefined,
          })
        })
      }
    } catch { /* silent */ }
    setTimeout(() => setIsSaving(false), 400)
  }, [json, html, content, title, subtitle, wpm, pasteCount, activeDraftId, selectedAssignment])

  const handlersRef = useRef({ handleSaveDraft, handleSubmit, handleExportPdf, handleExportDocx, isExporting, setFocusMode })
  handlersRef.current = { handleSaveDraft, handleSubmit, handleExportPdf, handleExportDocx, isExporting, setFocusMode }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const h = handlersRef.current

      // Ctrl+S — Save draft
      if (ctrl && !e.shiftKey && e.key === 's') {
        e.preventDefault()
        h.handleSaveDraft()
      }
      // Ctrl+Enter — Submit essay
      if (ctrl && e.key === 'Enter') {
        e.preventDefault()
        h.handleSubmit()
      }
      // Ctrl+Shift+E — Export PDF
      if (ctrl && e.shiftKey && e.key === 'e') {
        e.preventDefault()
        if (!h.isExporting) h.handleExportPdf()
      }
      // Ctrl+Shift+D — Export DOCX
      if (ctrl && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        if (!h.isExporting) h.handleExportDocx()
      }
      // Escape — Toggle focus mode
      if (e.key === 'Escape') {
        e.preventDefault()
        h.setFocusMode(v => !v)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    return () => {
      if (lastDocxUrl) URL.revokeObjectURL(lastDocxUrl)
      if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl)
    }
  }, [lastDocxUrl, lastPdfUrl])

  const contentLength = typeof content === 'string' ? content.length : html.length

  // ── Computed assignment helpers ──
  const activeAssignment = assignments.find(a => a.id === selectedAssignment)
  const currentWordCount = (typeof content === 'string' ? content : html).trim().split(/\s+/).filter(Boolean).length
  const wordLimit = activeAssignment?.max_word_count ?? null
  const wordLimitRatio = wordLimit ? currentWordCount / wordLimit : 0
  const isOverLimit = wordLimit ? currentWordCount > wordLimit : false
  const isNearLimit = wordLimit ? wordLimitRatio >= 0.9 && !isOverLimit : false

  // Due date helpers
  const dueDate = activeAssignment?.due_date ? new Date(activeAssignment.due_date) : null
  const nowMs = Date.now()
  const hoursUntilDue = dueDate ? (dueDate.getTime() - nowMs) / (1000 * 60 * 60) : null
  const isPastDue = hoursUntilDue !== null && hoursUntilDue < 0
  const isDueSoon = hoursUntilDue !== null && hoursUntilDue >= 0 && hoursUntilDue <= 24

  return (
    <div className="relative h-[125vh] w-full flex flex-col bg-background text-foreground overflow-hidden font-sans">
      {/* Background Effect - Reusing the Shader for consistency */}
      <div className="absolute inset-0 opacity-30 pointer-events-none z-0">
        <WebGLShader />
      </div>

      {!focusMode ? (
        <header className="relative z-10 flex items-center justify-between border-b border-border bg-background/50 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600" />
            <div className="flex flex-col gap-1">
              {/* Assignment Selector */}
              <select
                value={selectedAssignment}
                onChange={(e) => {
                  const assignmentId = e.target.value
                  setSelectedAssignment(assignmentId)
                  const a = assignments.find(a => a.id === assignmentId)
                  if (a) {
                    setTitle(a.title)
                    if (a.teacher_id) setSelectedTeacher(a.teacher_id)
                  }
                }}
                className="text-sm font-bold text-foreground bg-accent/20 border border-border rounded px-2 py-1 backdrop-blur-md focus:outline-none focus:border-ring/30 cursor-pointer appearance-none max-w-[260px]"
              >
                <option value="" className="bg-background text-foreground">Custom / Unassigned</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id} className="bg-background text-foreground">
                    {a.title}{a.due_date ? ` (Due ${new Date(a.due_date).toLocaleDateString()})` : ""}
                  </option>
                ))}
              </select>
              {/* Custom title or assignment info */}
              {!selectedAssignment ? (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Essay Title"
                  className="text-xs text-muted-foreground bg-accent/20 border border-border rounded px-2 py-1 backdrop-blur-md focus:outline-none focus:border-ring/30"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowInstructions(v => !v)}
                    className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <BookOpen className="h-3 w-3" />
                    {showInstructions ? 'Hide' : 'View'} Instructions
                    {showInstructions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {/* Due date badge */}
                  {dueDate && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${isPastDue ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : isDueSoon ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                        : 'bg-green-500/10 text-green-400 border border-green-500/20'
                      }`}>
                      <Clock className="h-3 w-3" />
                      {isPastDue ? 'Past Due' : isDueSoon ? `Due in ${Math.ceil(hoursUntilDue!)}h` : `Due ${dueDate.toLocaleDateString()}`}
                    </span>
                  )}
                  {/* Word limit badge */}
                  {wordLimit && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${isOverLimit ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : isNearLimit ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                        : 'bg-white/5 text-white/40 border border-white/10'
                      }`}>
                      {currentWordCount.toLocaleString()} / {wordLimit.toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Teacher Selector */}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3 relative"
              asChild
            >
              <div className="flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5" />
                <select
                  value={selectedTeacher}
                  onChange={(e) => setSelectedTeacher(e.target.value)}
                  className="bg-transparent text-xs font-medium text-current focus:outline-none cursor-pointer appearance-none pr-1"
                >
                  <option value="" className="bg-background text-foreground">Submit to…</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id} className="bg-background text-foreground">
                      {t.username.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
            </Button>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportDocx}
                disabled={isExporting}
                title="Export as DOCX (Ctrl+Shift+D)"
                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-2 disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                .docx
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportPdf}
                disabled={isExporting}
                title="Export as PDF (Ctrl+Shift+E)"
                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-2 disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                .pdf
              </Button>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-border bg-accent/20 px-3 py-1">
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-white/50" />
                  <span className="text-xs font-medium text-muted-foreground">Saving...</span>
                </>
              ) : (
                <>
                  <Save className="h-3 w-3 text-white/30" />
                  <span className="text-xs font-medium text-muted-foreground">Saved</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1" data-integrity-state={status}>
              {status === "verified" && <CheckCircle className="h-4 w-4 text-green-500" />}
              {status === "warning" && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
              {status === "suspicious" && <AlertTriangle className="h-4 w-4 text-red-500" />}
              <span className={`text-xs font-medium ${status === 'verified' ? 'text-green-500' : status === 'suspicious' ? 'text-red-500' : 'text-yellow-500'}`}>
                {status === "verified" ? "Integrity Verified" : status === "suspicious" ? "Unusual Speed" : "Integrity Warning"}
              </span>
            </div>
            <Button id="focus-mode-btn" variant="ghost" size="sm" onClick={() => setFocusMode(v => !v)} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3">
              {focusMode ? "Exit Focus" : "Focus Mode"}
            </Button>
            <Button id="profile-btn" variant="ghost" size="sm" onClick={() => router.push("/profile")} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3">Profile</Button>
            <Button id="submissions-btn" variant="ghost" size="sm" onClick={() => router.push("/submissions")} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3">My Submissions</Button>
            <Button id="drafts-btn" variant="ghost" size="sm" onClick={() => router.push("/drafts")} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3">My Drafts</Button>
            <Button id="logout-btn" variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3">Logout</Button>
            <ThemeToggle />
            <Button id="submit-essay-btn" title="Submit Essay (Ctrl+Enter)" className="bg-foreground text-background hover:bg-muted-foreground/20" onClick={handleSubmit}>Submit Essay</Button>
          </div>
        </header>
      ) : null}

      {/* Assignment Instructions Panel */}
      {showInstructions && activeAssignment && (
        <div className="relative z-10 border-b border-border bg-accent/10 backdrop-blur-md px-6 py-4 animate-in slide-in-from-top duration-200">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-foreground mb-2">{activeAssignment.title}</h3>
                {activeAssignment.description && (
                  <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {activeAssignment.description.replace(/<[^>]*>/g, '')}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3">
                  {dueDate && (
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isPastDue ? 'text-red-400' : isDueSoon ? 'text-yellow-400' : 'text-muted-foreground'
                      }`}>
                      <Clock className="h-3.5 w-3.5" />
                      Due: {dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at {dueDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      {isPastDue && <span className="text-red-400 font-semibold ml-1">(Past Due!)</span>}
                      {isDueSoon && !isPastDue && <span className="text-yellow-400 font-semibold ml-1">(Due Soon)</span>}
                    </span>
                  )}
                  {wordLimit && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Word Limit: {wordLimit.toLocaleString()} words
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setShowInstructions(false)} className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="relative z-10 flex flex-1 overflow-hidden min-h-0">

        {/* Editor Canvas */}
        <div className="relative flex-1 overflow-hidden flex flex-col bg-background/20 backdrop-blur-md border-l border-border min-h-0">
          {focusMode ? (
            <div className="absolute right-6 top-6 z-20 flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-border bg-accent/20 px-3 py-1" data-integrity-state={status}>
                {status === "verified" && <CheckCircle className="h-4 w-4 text-green-500" />}
                {status === "warning" && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                {status === "suspicious" && <AlertTriangle className="h-4 w-4 text-red-500" />}
                <span className={`text-xs font-medium ${status === 'verified' ? 'text-green-500' : status === 'suspicious' ? 'text-red-500' : 'text-yellow-500'}`}>
                  {status === "verified" ? "Integrity Verified" : status === "suspicious" ? "Unusual Speed" : "Integrity Warning"}
                </span>
              </div>
              <span className="text-xs font-medium text-muted-foreground">Focus Mode Enabled</span>
              <Button variant="ghost" size="sm" onClick={() => setFocusMode(false)} className="text-muted-foreground hover:text-foreground hover:bg-accent/50 h-8 px-3">
                Exit Focus
              </Button>
            </div>
          ) : null}
          {isLoaded ? (
            <RichEditor
              key={activeDraftId || "local"}
              content={content}
              onChange={(text) => {
                const now = Date.now()

                // Record session start
                if (!startTime && text.length > 0) {
                  setStartTime(now)
                }

                const lastAt = lastTypingAtRef.current
                const lastLen = lastTypingLenRef.current
                const deltaChars = Math.max(0, text.length - lastLen)

                // ── Active typing time tracking ──
                // Only count the time since the last keystroke if the gap
                // is shorter than IDLE_THRESHOLD_MS (user was actively typing).
                if (lastAt && deltaChars > 0) {
                  const gap = now - lastAt
                  if (gap < IDLE_THRESHOLD_MS) {
                    activeTypingMsRef.current += gap
                  }
                }

                // ── Real WPM = (non-space chars / 5) / active minutes ──
                // Industry-standard: 1 word = 5 characters (letters only).
                // This prevents spaces / enter from inflating WPM.
                const activeMinutes = activeTypingMsRef.current / 60000
                if (activeMinutes > 0.16) { // need at least ~10 seconds of active typing
                  const letterCount = (text.match(/\S/g) || []).length
                  const computedWpm = Math.round((letterCount / 5) / activeMinutes)
                  setWpm(Math.min(computedWpm, 300)) // cap at 300 to prevent display glitches
                }

                // ── Instant-speed integrity check ──
                // Only flag truly suspicious bursts: require at least 10 chars
                // typed in a gap of at least 500ms to avoid noise from
                // normal fast keystrokes or autocorrect.
                if (lastAt && deltaChars >= 10) {
                  const gapMs = now - lastAt
                  if (gapMs >= 500) {
                    const gapMinutes = gapMs / 60000
                    const instantWpm = Math.round((deltaChars / 5) / gapMinutes)
                    if (instantWpm >= 200) {
                      resetStatusAfterDelay("suspicious")
                    }
                  }
                }

                lastTypingAtRef.current = now
                lastTypingLenRef.current = text.length
                setContent(text)
              }}
              onPaste={handlePaste}
              onHtmlChange={setHtml}
              onJsonChange={setJson}
              onSnapshot={(snapshot) => {
                const rawNow = snapshot.timestamp
                const lastRaw = lastRawSnapshotTimeRef.current
                lastRawSnapshotTimeRef.current = rawNow

                setReplaySnapshots(prev => {
                  const last = prev[prev.length - 1]
                  let effectiveTimestamp = snapshot.timestamp

                  // ── Time Compression Logic ──
                  // Compresses idle gaps > 5000ms down to 1000ms while preserving real keystroke deltas,
                  // avoiding subtraction of compressed timestamps from raw wall-clock Date.now().
                  if (last) {
                    const rawGap = lastRaw !== null ? Math.max(0, rawNow - lastRaw) : 5001
                    const delta = Math.max(1, rawGap > 5000 ? 1000 : rawGap)
                    effectiveTimestamp = last.timestamp + delta
                  }

                  const nextSnapshot = { ...snapshot, timestamp: effectiveTimestamp }
                  const next = [...prev, nextSnapshot]

                  // Persist to IndexedDB (fire and forget)
                  saveToDB("clio_replay_snapshots", next).catch(() => { })
                  return next
                })
              }}
              showToolbar={!focusMode}
            />
          ) : (
            <div className="flex items-center justify-center h-full w-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Right Sidebar (Analytics) */}
        {!focusMode ? (
          <aside className="w-80 border-l border-border bg-background/20 p-6 backdrop-blur-md hidden md:block">
            <h2 className="mb-6 text-xs font-bold uppercase tracking-wider text-muted-foreground">Session Analytics</h2>
            <p className="mb-4 text-xs text-muted-foreground">Behavioral analytics processed locally</p>

            <div className="space-y-6">
              {/* WPM Card */}
              <div className="rounded-xl border border-border bg-accent/20 p-4">
                <p className="text-xs text-muted-foreground">Typing Speed</p>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-foreground">{wpm}</span>
                  <span className="text-sm text-muted-foreground">WPM</span>
                </div>
                {(wpm > 150 || status === "suspicious") && <p className="mt-2 text-xs text-red-400">⚠️ Unusual Speed</p>}
              </div>

              {/* Paste Count Card */}
              <div className="rounded-xl border border-border bg-accent/20 p-4">
                <p className="text-xs text-muted-foreground">Paste Events</p>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className={`text-3xl font-bold ${pasteCount > 0 ? 'text-yellow-500' : 'text-foreground'}`}>
                    {pasteCount}
                  </span>
                  <span className="text-sm text-muted-foreground">detected</span>
                </div>
              </div>

              {/* Word Count Card with Limit Enforcement */}
              <div className={`rounded-xl border p-4 transition-colors ${isOverLimit ? 'border-red-500/30 bg-red-500/5'
                : isNearLimit ? 'border-yellow-500/30 bg-yellow-500/5'
                  : 'border-border bg-accent/20'
                }`}>
                <p className="text-xs text-muted-foreground">Word Count</p>
                <div className="mt-1 flex items-baseline gap-1">
                  <span id="word-count-value" className={`text-3xl font-bold ${isOverLimit ? 'text-red-400' : isNearLimit ? 'text-yellow-400' : 'text-foreground'
                    }`}>
                    {currentWordCount.toLocaleString()}
                  </span>
                  {wordLimit ? (
                    <span className="text-sm text-muted-foreground">/ {wordLimit.toLocaleString()}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">words</span>
                  )}
                </div>
                {wordLimit && (
                  <>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-accent/30 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${isOverLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : 'bg-blue-500'
                          }`}
                        style={{ width: `${Math.min(100, wordLimitRatio * 100)}%` }}
                      />
                    </div>
                    {isOverLimit && (
                      <p className="mt-1.5 text-[10px] text-red-400 font-medium">⚠ Over limit by {(currentWordCount - wordLimit).toLocaleString()} words</p>
                    )}
                    {isNearLimit && (
                      <p className="mt-1.5 text-[10px] text-yellow-400 font-medium">Approaching word limit ({(wordLimit - currentWordCount).toLocaleString()} remaining)</p>
                    )}
                  </>
                )}
              </div>
              {contentLength > 2000 ? (
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-xs text-muted-foreground">Performance</p>
                  <p className="mt-2 text-sm text-foreground">Editor Performance Test Completed</p>
                </div>
              ) : null}


              {/* Integrity Score Visual */}
              <div className="rounded-xl border border-border bg-accent/20 p-4">
                <p className="text-xs text-muted-foreground">Projected Integrity Score</p>
                <div className="mt-4 h-2 w-full rounded-full bg-accent/30">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.max(0, 100 - (pasteCount * 10))}%` }}
                  />
                </div>
                <p className="mt-2 text-right text-xs font-bold text-green-400">
                  {Math.max(0, 100 - (pasteCount * 10))}
                </p>
              </div>
              <SpotifyCard />

              {/* Snapshot indicator (replay is available to teachers) */}
              <div className="rounded-xl border border-border bg-accent/20 p-4">
                <p className="text-xs text-muted-foreground">Session Recording</p>
                <p className="mt-2 text-sm text-muted-foreground font-mono">{replaySnapshots.length} <span className="text-muted-foreground text-xs">snapshots captured</span></p>
                <p className="mt-1 text-xs text-muted-foreground">Your teacher can watch the writing replay</p>
              </div>
            </div>
          </aside>
        ) : null}


      </main>
      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState(prev => ({ ...prev, isOpen: false }))}
        title={modalState.title}
        footer={
          modalState.type === "confirm" ? (
            <>
              <Button variant="ghost" onClick={() => setModalState(prev => ({ ...prev, isOpen: false }))}>Cancel</Button>
              <Button onClick={() => {
                if (modalState.onConfirm) modalState.onConfirm()
                // Don't close immediately, let the handler set loading state
              }}>Confirm</Button>
            </>
          ) : modalState.type === "loading" ? (
            <Button disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</Button>
          ) : (
            <Button onClick={() => setModalState(prev => ({ ...prev, isOpen: false }))}>Close</Button>
          )
        }
      >
        <div className="whitespace-pre-line">{modalState.message}</div>
      </Modal>
    </div>
  )
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <EditorPageContent />
    </Suspense>
  )
}
