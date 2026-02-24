import { useRef, useState, useEffect } from 'react'

const COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
  '#30B0C7', '#32ADE6', '#5856D6', '#AF52DE', '#FF2D55',
]

const HANDLE_SIZE = 8
const ZOOM_MIN    = 0.25
const ZOOM_MAX    = 10.0
const ZOOM_FACTOR = 1.25

// For each corner (TL=0, TR=1, BL=2, BR=3): offset multiplier to reach the fixed (opposite) corner
const CORNER_FIXED = [
  { dx:  0.5, dy:  0.5 },  // TL → fixed = BR
  { dx: -0.5, dy:  0.5 },  // TR → fixed = BL
  { dx:  0.5, dy: -0.5 },  // BL → fixed = TR
  { dx: -0.5, dy: -0.5 },  // BR → fixed = TL
]

export default function AnnotationCanvas({ imageFile, boxes, onBoxesChange, classId, classNames = {}, classColors = {}, selIdx, onSelectionChange, controlsRef, onZoomChange, onDeleteLabels }) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)
  const imgRef       = useRef(null)
  const txRef        = useRef(null)       // { ox, oy, dw, dh }
  const drawRef      = useRef(null)       // new box drawing: { start, cur }
  const interactRef  = useRef(null)       // resize/move: { type, ..., curNorm }
  const zoomRef      = useRef(1.0)
  const panRef       = useRef({ px: 0, py: 0 })
  const panDragRef   = useRef(null)       // middle-mouse pan: { lastX, lastY }
  const changeZoomRef = useRef(null)      // always-fresh zoom function
  const [showConfirm, setShowConfirm] = useState(false)
  const yesRef = useRef(null)


  // ── Core draw/transform ────────────────────────────────────────────────────

  const redrawRef = useRef(null)
  redrawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const img = imgRef.current
    const tx  = txRef.current
    if (img && tx) ctx.drawImage(img, tx.ox, tx.oy, tx.dw, tx.dh)

    const interact = interactRef.current
    boxes.forEach((box, i) => {
      if (interact && i === selIdx) {
        const preview = computeInteractBox(interact, interact.curNorm, box)
        drawBox(ctx, preview ?? box, true, false)
      } else {
        drawBox(ctx, box, i === selIdx, false)
      }
    })

    // draw corner handles for selected box
    if (selIdx !== null && boxes[selIdx]) {
      const displayBox = interact
        ? (computeInteractBox(interact, interact.curNorm, boxes[selIdx]) ?? boxes[selIdx])
        : boxes[selIdx]
      drawHandles(ctx, displayBox)
    }

    if (drawRef.current && tx) {
      const { start, cur } = drawRef.current
      drawBox(ctx, {
        class_id: classId,
        x: (start.x + cur.x) / 2,
        y: (start.y + cur.y) / 2,
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      }, false, true)
    }
  }

  function computeTransform() {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    const baseScale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.97
    const scale = baseScale * zoomRef.current
    const dw = img.width  * scale
    const dh = img.height * scale
    const pan = panRef.current
    // Clamp pan so the image can't completely leave the canvas
    const margin = 40
    pan.px = Math.max(-(dw - margin), Math.min(canvas.width  - margin, pan.px))
    pan.py = Math.max(-(dh - margin), Math.min(canvas.height - margin, pan.py))
    txRef.current = {
      ox: (canvas.width  - dw) / 2 + pan.px,
      oy: (canvas.height - dh) / 2 + pan.py,
      dw,
      dh,
    }
  }

  // Always-fresh zoom function stored in a ref so the wheel useEffect can call it
  changeZoomRef.current = (newLevel, pivotX, pivotY) => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newLevel))
    const tx = txRef.current
    if (tx) {
      const px = pivotX ?? canvas.width  / 2
      const py = pivotY ?? canvas.height / 2
      const nx = (px - tx.ox) / tx.dw
      const ny = (py - tx.oy) / tx.dh
      const baseScale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.97
      const newDw = img.width  * baseScale * clamped
      const newDh = img.height * baseScale * clamped
      panRef.current.px = px - canvas.width  / 2 + newDw * (0.5 - nx)
      panRef.current.py = py - canvas.height / 2 + newDh * (0.5 - ny)
    }
    zoomRef.current = clamped
    onZoomChange?.(clamped)
    computeTransform()
    redrawRef.current()
  }

  function resetZoom() {
    zoomRef.current  = 1.0
    panRef.current   = { px: 0, py: 0 }
    onZoomChange?.(1.0)
    computeTransform()
    redrawRef.current()
  }

  // ── Box drawing helpers ────────────────────────────────────────────────────

  function drawHandles(ctx, box) {
    const tx = txRef.current
    if (!tx) return
    const bx = (box.x - box.w / 2) * tx.dw + tx.ox
    const by = (box.y - box.h / 2) * tx.dh + tx.oy
    const bw = box.w * tx.dw
    const bh = box.h * tx.dh
    const hs = HANDLE_SIZE
    const corners = [
      [bx,      by     ],
      [bx + bw, by     ],
      [bx,      by + bh],
      [bx + bw, by + bh],
    ]
    corners.forEach(([cx, cy]) => {
      ctx.fillStyle   = '#ffffff'
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs)
      ctx.strokeStyle = '#555555'
      ctx.lineWidth   = 1
      ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs)
    })
  }

  function computeInteractBox(interact, norm, box) {
    if (!norm || !box) return null
    if (interact.type === 'resize') {
      const { fixedX, fixedY } = interact
      const mx = Math.max(0, Math.min(1, norm.x))
      const my = Math.max(0, Math.min(1, norm.y))
      const w  = Math.max(0.005, Math.abs(mx - fixedX))
      const h  = Math.max(0.005, Math.abs(my - fixedY))
      return { ...box, x: (mx + fixedX) / 2, y: (my + fixedY) / 2, w, h }
    } else if (interact.type === 'move') {
      const { offsetX, offsetY } = interact
      const cx = Math.max(box.w / 2, Math.min(1 - box.w / 2, norm.x - offsetX))
      const cy = Math.max(box.h / 2, Math.min(1 - box.h / 2, norm.y - offsetY))
      return { ...box, x: cx, y: cy }
    }
    return null
  }

  function drawBox(ctx, box, selected, preview) {
    const tx = txRef.current
    if (!tx) return
    const x     = (box.x - box.w / 2) * tx.dw + tx.ox
    const y     = (box.y - box.h / 2) * tx.dh + tx.oy
    const w     = box.w * tx.dw
    const h     = box.h * tx.dh
    const color = classColors[box.class_id] ?? COLORS[box.class_id % COLORS.length]

    ctx.fillStyle = color + (preview ? '40' : '25')
    ctx.fillRect(x, y, w, h)

    ctx.strokeStyle = selected ? '#fff' : color
    ctx.lineWidth   = selected ? 3 : 2
    if (preview) ctx.setLineDash([6, 4])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])

    if (w > 20 && h > 20) {
      const name  = classNames[box.class_id]
      const label = name ? `${box.class_id}:${name}` : `#${box.class_id}`
      ctx.font = 'bold 13px monospace'
      const tw = ctx.measureText(label).width + 8
      const lw = selected ? 3 : 2
      const lx = x - lw / 2
      ctx.fillStyle = selected ? '#ffffff' : color
      ctx.fillRect(lx, Math.max(0, y - 22), tw, 22)
      ctx.fillStyle = selected ? '#FF3B30' : '#fff'
      ctx.fillText(label, lx + 4, Math.max(15, y - 6))
    }
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  // Load image when imageFile changes — also reset zoom/pan
  useEffect(() => {
    onSelectionChange(null)
    drawRef.current     = null
    interactRef.current = null
    zoomRef.current     = 1.0
    panRef.current      = { px: 0, py: 0 }
    onZoomChange?.(1.0)
    if (!imageFile) return
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      computeTransform()
      redrawRef.current()
    }
    img.src = `/api/images/${encodeURIComponent(imageFile)}`
  }, [imageFile])

  // Redraw when boxes / classId / selection / classColors change
  useEffect(() => {
    redrawRef.current()
  }, [boxes, classId, selIdx, classColors])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width  = width
        canvas.height = height
        computeTransform()
        redrawRef.current()
      }
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [])

  // Scroll-wheel zoom centered on mouse
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      if (!txRef.current) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const rect   = canvas.getBoundingClientRect()
      changeZoomRef.current?.(zoomRef.current * factor, e.clientX - rect.left, e.clientY - rect.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Auto-focus Yes button when confirm dialog opens
  useEffect(() => {
    if (showConfirm) yesRef.current?.focus()
  }, [showConfirm])

  // Delete selected box with Del / Backspace
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey) {
        if (selIdx !== null) {
          e.preventDefault()
          onBoxesChange(boxes.filter((_, i) => i !== selIdx))
          onSelectionChange(null)
        } else {
          e.preventDefault()
          if (boxes.length > 0) {
            setShowConfirm(true)
          } else {
            onDeleteLabels?.()
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selIdx, boxes, onBoxesChange, onSelectionChange, onDeleteLabels])

  // ── Mouse helpers ──────────────────────────────────────────────────────────

  function getCanvasNorm(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const tx   = txRef.current
    if (!tx) return null
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left - tx.ox) / tx.dw)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top  - tx.oy) / tx.dh)),
    }
  }

  function getCanvasPixel(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  // Returns which handle the pixel hits (0-3), or -1 if none
  function checkHandle(pixel, box) {
    const tx = txRef.current
    if (!tx) return -1
    const bx = (box.x - box.w / 2) * tx.dw + tx.ox
    const by = (box.y - box.h / 2) * tx.dh + tx.oy
    const bw = box.w * tx.dw
    const bh = box.h * tx.dh
    const corners = [
      [bx,      by     ],
      [bx + bw, by     ],
      [bx,      by + bh],
      [bx + bw, by + bh],
    ]
    const hit = HANDLE_SIZE / 2 + 2
    for (let i = 0; i < corners.length; i++) {
      if (Math.abs(pixel.px - corners[i][0]) <= hit && Math.abs(pixel.py - corners[i][1]) <= hit) return i
    }
    return -1
  }

  function findBox(norm) {
    let found = -1, minArea = Infinity
    boxes.forEach((b, i) => {
      if (norm.x >= b.x - b.w / 2 && norm.x <= b.x + b.w / 2 &&
          norm.y >= b.y - b.h / 2 && norm.y <= b.y + b.h / 2) {
        const area = b.w * b.h
        if (area < minArea) { minArea = area; found = i }
      }
    })
    return found
  }

  function setCursor(type) {
    if (canvasRef.current) canvasRef.current.style.cursor = type
  }

  // ── Mouse event handlers ───────────────────────────────────────────────────

  const onMouseDown = (e) => {
    // Middle mouse → pan
    if (e.button === 1) {
      e.preventDefault()
      panDragRef.current = { lastX: e.clientX, lastY: e.clientY }
      setCursor('grabbing')
      return
    }
    if (e.button !== 0) return

    const norm = getCanvasNorm(e)
    if (!norm) return

    // Check selected box handles / interior
    if (selIdx !== null && boxes[selIdx]) {
      const box      = boxes[selIdx]
      const pixel    = getCanvasPixel(e)
      const cornerIdx = checkHandle(pixel, box)

      if (cornerIdx !== -1) {
        // Start resize: store opposite corner as fixed anchor
        const opp = CORNER_FIXED[cornerIdx]
        interactRef.current = {
          type:   'resize',
          fixedX: box.x + opp.dx * box.w,
          fixedY: box.y + opp.dy * box.h,
          curNorm: norm,
        }
        setCursor(cornerIdx === 0 || cornerIdx === 3 ? 'nwse-resize' : 'nesw-resize')
        return
      }

      // Click inside box → start move
      if (norm.x >= box.x - box.w / 2 && norm.x <= box.x + box.w / 2 &&
          norm.y >= box.y - box.h / 2 && norm.y <= box.y + box.h / 2) {
        interactRef.current = {
          type:    'move',
          offsetX: norm.x - box.x,
          offsetY: norm.y - box.y,
          curNorm: norm,
        }
        setCursor('move')
        return
      }
    }

    // Start regular draw
    drawRef.current = { start: norm, cur: norm }
    redrawRef.current()
  }

  const onMouseMove = (e) => {
    // Pan drag (middle mouse)
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.lastX
      const dy = e.clientY - panDragRef.current.lastY
      panDragRef.current = { lastX: e.clientX, lastY: e.clientY }
      panRef.current.px += dx
      panRef.current.py += dy
      computeTransform()
      redrawRef.current()
      return
    }

    const norm = getCanvasNorm(e)

    // Resize / move drag
    if (interactRef.current) {
      if (!norm) return
      interactRef.current.curNorm = norm
      redrawRef.current()
      return
    }

    // Update cursor on hover
    if (selIdx !== null && boxes[selIdx]) {
      const box       = boxes[selIdx]
      const pixel     = getCanvasPixel(e)
      const cornerIdx = checkHandle(pixel, box)
      if (cornerIdx !== -1) {
        setCursor(cornerIdx === 0 || cornerIdx === 3 ? 'nwse-resize' : 'nesw-resize')
      } else if (norm &&
          norm.x >= box.x - box.w / 2 && norm.x <= box.x + box.w / 2 &&
          norm.y >= box.y - box.h / 2 && norm.y <= box.y + box.h / 2) {
        setCursor('move')
      } else {
        setCursor('crosshair')
      }
    } else {
      setCursor('crosshair')
    }

    if (!drawRef.current || !norm) return
    drawRef.current.cur = norm
    redrawRef.current()
  }

  const onMouseUp = () => {
    // End pan drag
    if (panDragRef.current) {
      panDragRef.current = null
      setCursor('crosshair')
      return
    }

    // Commit resize / move
    if (interactRef.current) {
      const { curNorm } = interactRef.current
      if (curNorm && selIdx !== null && boxes[selIdx]) {
        const newBox = computeInteractBox(interactRef.current, curNorm, boxes[selIdx])
        if (newBox) onBoxesChange(boxes.map((b, i) => i === selIdx ? newBox : b))
      }
      interactRef.current = null
      setCursor('crosshair')
      redrawRef.current()
      return
    }

    if (!drawRef.current) return
    const { start, cur } = drawRef.current
    const w = Math.abs(cur.x - start.x)
    const h = Math.abs(cur.y - start.y)
    const DRAG_THRESHOLD_PX = 5
    const tx = txRef.current
    const wPx = w * (tx?.dw ?? 1)
    const hPx = h * (tx?.dh ?? 1)

    if (wPx > DRAG_THRESHOLD_PX && hPx > DRAG_THRESHOLD_PX) {
      onBoxesChange([...boxes, {
        class_id: classId,
        x: (start.x + cur.x) / 2,
        y: (start.y + cur.y) / 2,
        w,
        h,
      }])
      onSelectionChange(null)
    } else {
      const hit = findBox(start)
      onSelectionChange(hit !== -1 ? hit : null)
    }

    drawRef.current = null
    redrawRef.current()
  }

  // ── Expose zoom controls to parent ────────────────────────────────────────

  if (controlsRef) {
    controlsRef.current = {
      zoomIn:    () => changeZoomRef.current?.(zoomRef.current * ZOOM_FACTOR),
      zoomOut:   () => changeZoomRef.current?.(zoomRef.current / ZOOM_FACTOR),
      resetZoom,
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="canvas-container" style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: 'crosshair', display: 'block' }}
      />


      {/* Watermark — bottom-right */}
      <div style={{
        position: 'absolute', bottom: 0, right: 20,
        height: 12,
        display: 'flex', alignItems: 'center', gap: 8,
        pointerEvents: 'none', userSelect: 'none',
      }}>
        <span style={{
          display: 'block', width: 24, height: 1,
          background: 'rgba(255,255,255,0.25)',
        }} />
        <span style={{
          fontSize: 11, letterSpacing: '0.16em', fontWeight: 600,
          color: 'rgba(255,255,255,0.25)',
          textTransform: 'uppercase',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}>Nongshim · Digital Strategy Team</span>
        <span style={{
          display: 'block', width: 24, height: 1,
          background: 'rgba(255,255,255,0.25)',
        }} />
      </div>

      {showConfirm && (
        <div className="confirm-overlay" onKeyDown={e => {
          if (e.key === 'Escape') setShowConfirm(false)
        }}>
          <div className="confirm-dialog">
            <p className="confirm-msg">Delete all boxes in this image?</p>
            <div className="confirm-btns">
              <button
                ref={yesRef}
                className="confirm-btn yes"
                onClick={() => { onBoxesChange([]); onSelectionChange(null); setShowConfirm(false); onDeleteLabels?.() }}
              >Yes</button>
              <button
                className="confirm-btn no"
                onClick={() => setShowConfirm(false)}
              >No</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
