import { useState, useEffect, useCallback, useRef } from 'react'
import ThumbnailStrip from './components/ThumbnailStrip'
import AnnotationCanvas from './components/AnnotationCanvas'


const PALETTE_COLORS = [
  '#FF3B30', // red
  '#FF8000', // orange
  '#DDAA00', // gold/amber
  '#AADD00', // lime
  '#00BB44', // green
  '#00CCAA', // teal
  '#0099CC', // sky blue
  '#00AAFF', // bright blue
  '#0044CC', // blue
  '#5500CC', // purple
  '#AA00CC', // magenta
  '#FF0080', // hot pink
  '#994400', // brown
  '#1A3A5C', // dark navy
  '#8899AA', // steel gray
  '#FFD000', // yellow
]

const DEFAULT_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
  '#30B0C7', '#32ADE6', '#5856D6', '#AF52DE', '#FF2D55',
]

const MAX_HISTORY = 20

const MODEL_OPTIONS = [
  { value: 'yolo12n.pt', label: 'Nano   (n)', desc: '가장 빠름 · 정확도 낮음 · 처음 시작하거나 데이터가 적을 때 추천' },
  { value: 'yolo12s.pt', label: 'Small  (s)', desc: '빠른 속도 · 보통 정확도 · 가벼운 환경에서 실용적 선택' },
  { value: 'yolo12m.pt', label: 'Medium (m)', desc: '속도와 정확도의 균형 · 충분한 GPU 메모리(4GB+) 필요' },
  { value: 'yolo12l.pt', label: 'Large  (l)', desc: '높은 정확도 · 느린 속도 · 고성능 GPU(8GB+) 권장' },
  { value: 'yolo12x.pt', label: 'Extra  (x)', desc: '최고 정확도 · 가장 느림 · 최상위 사양에서만 권장' },
]

const DEVICE_OPTIONS = [
  { value: '',    label: 'Auto', desc: 'GPU가 있으면 자동으로 사용, 없으면 CPU로 전환 (기본값 · 대부분의 경우 이것을 선택)' },
  { value: '0',   label: 'GPU',  desc: 'NVIDIA GPU를 강제로 사용 · 학습이 10~50배 빠름 · GPU가 없으면 오류 발생' },
  { value: 'cpu', label: 'CPU',  desc: 'CPU만 사용 · 모든 PC에서 동작하지만 매우 느림 · GPU가 없을 때만 사용' },
]

export default function App() {
  const [images, setImages] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [boxes, setBoxes] = useState([])
  const [classId, setClassId] = useState(0)
  const [loading, setLoading] = useState(true)

  const [classNames, setClassNames] = useState({})   // { 0: 'object', 1: 'cat', ... }
  const [editingClassId, setEditingClassId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [saveForTrainingStatus, setSaveForTrainingStatus] = useState(null) // null | 'saving' | 'ok' | 'error'
  const [classColors, setClassColors] = useState(() => {
    try { return JSON.parse(localStorage.getItem('classColors') || '{}') } catch { return {} }
  })
  const [colorPickerOpen, setColorPickerOpen] = useState(null) // null | { id, top, left }
  const [selIdx, setSelIdx] = useState(null)
  const [clipboardData, setClipboardData] = useState(null) // { box, source_image }
  const [sidebarWidth, setSidebarWidth] = useState(270)
  const [annotatedFiles, setAnnotatedFiles] = useState({})
  const [zoomLevel, setZoomLevel] = useState(1.0)
  const canvasControlsRef = useRef(null)

  // ── Predict state ──────────────────────────────────────────────────────────
  const [predictOpen, setPredictOpen]       = useState(false)
  const [predictRuns, setPredictRuns]       = useState([])
  const [predictRunsLoading, setPredictRunsLoading] = useState(false)
  const [conf, setConf] = useState(() => parseFloat(localStorage.getItem('predict_conf') ?? '0.25'))
  const [iou,  setIou]  = useState(() => parseFloat(localStorage.getItem('predict_iou')  ?? '0.45'))
  const [confInput, setConfInput] = useState(null)
  const [iouInput,  setIouInput]  = useState(null)
  const [selectedRun, setSelectedRun] = useState(() => {
    try { return JSON.parse(localStorage.getItem('predict_run')) ?? null } catch { return null }
  })
  const [predicting, setPredicting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // run name being deleted
  const [deleteInput, setDeleteInput] = useState('')

  // ── Training state ──────────────────────────────────────────────────────────
  const [trainOpen, setTrainOpen] = useState(false)
  const [trainRunning, setTrainRunning] = useState(false)
  const [trainStatus, setTrainStatus] = useState('idle') // idle|running|done|error|stopped
  const [trainLogs, setTrainLogs] = useState([])
  const [trainConfig, setTrainConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('train_config') || '{}') } catch { return {} }
  })

  const boxesRef = useRef([])
  const currentIndexRef = useRef(0)
  const sidebarWidthRef = useRef(270)
  const imagesRef = useRef([])

  const selIdxRef = useRef(null)
  const classNamesRef = useRef({})
  const clipboardDataRef = useRef(null)
  const undoStackRef = useRef([])   // array of boxes snapshots (past)
  const redoStackRef = useRef([])   // array of boxes snapshots (future)
  const trainLogOffsetRef = useRef(0)
  const trainPollRef = useRef(null)
  const trainLogRef = useRef(null)

  useEffect(() => { boxesRef.current = boxes }, [boxes])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { imagesRef.current = images }, [images])
  useEffect(() => { localStorage.setItem('classColors', JSON.stringify(classColors)) }, [classColors])
  useEffect(() => { localStorage.setItem('train_config', JSON.stringify(trainConfig)) }, [trainConfig])
  useEffect(() => { selIdxRef.current = selIdx }, [selIdx])
  useEffect(() => { classNamesRef.current = classNames }, [classNames])
  useEffect(() => { clipboardDataRef.current = clipboardData }, [clipboardData])

  // Fetch image list on mount
  useEffect(() => {
    fetch('/api/images')
      .then(r => r.json())
      .then(data => { setImages(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Fetch class names on mount
  useEffect(() => {
    fetch('/api/classes')
      .then(r => r.json())
      .then(data => setClassNames(
        Object.fromEntries(Object.entries(data).map(([k, v]) => [+k, v]))
      ))
      .catch(() => {})
  }, [])

  // Fetch annotation status on mount
  useEffect(() => {
    fetch('/api/annotations-status')
      .then(r => r.json())
      .then(data => setAnnotatedFiles(data))
      .catch(() => {})
  }, [])

  // Load persisted clipboard on mount
  useEffect(() => {
    fetch('/api/clipboard')
      .then(r => r.json())
      .then(data => { if (data.box) setClipboardData(data) })
      .catch(() => {})
  }, [])

  // Sidebar resize
  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    const onMouseMove = (e) => {
      const newWidth = Math.min(480, Math.max(180, startWidth + e.clientX - startX))
      sidebarWidthRef.current = newWidth
      setSidebarWidth(newWidth)
    }
    const onMouseUp = () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  // Save class names to dataset.yaml via backend
  const saveClassNames = useCallback(async (names) => {
    try {
      await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          Object.fromEntries(Object.entries(names).map(([k, v]) => [String(k), v]))
        ),
      })
    } catch {}
  }, [])

  // ── Class management ──────────────────────────────────
  const addClass = useCallback(() => {
    const ids = Object.keys(classNames).map(Number)
    const newId = ids.length > 0 ? Math.max(...ids) + 1 : 0
    const newName = `class_${newId}`
    const newNames = { ...classNames, [newId]: newName }
    setClassNames(newNames)
    saveClassNames(newNames)
    setEditingClassId(newId)
    setEditingValue(newName)
  }, [classNames, saveClassNames])

  const deleteClass = useCallback((id) => {
    const newNames = { ...classNames }
    delete newNames[id]
    setClassNames(newNames)
    saveClassNames(newNames)
    if (classId === id) {
      const remaining = Object.keys(newNames).map(Number).sort((a, b) => a - b)
      setClassId(remaining.length > 0 ? remaining[0] : 0)
    }
  }, [classNames, classId, saveClassNames])

  const startEdit = useCallback((id, name) => {
    setEditingClassId(id)
    setEditingValue(name)
  }, [])

  const commitEdit = useCallback((id) => {
    const trimmed = editingValue.trim()
    if (trimmed) {
      const newNames = { ...classNames, [id]: trimmed }
      setClassNames(newNames)
      saveClassNames(newNames)
    }
    setEditingClassId(null)
    setEditingValue('')
  }, [classNames, editingValue, saveClassNames])

  // Move current image (+ label) to trash folder
  const deleteCurrentImage = useCallback(async () => {
    const imgs = imagesRef.current
    const idx = currentIndexRef.current
    const filename = imgs[idx]
    if (!filename) return
    await fetch(`/api/images/${encodeURIComponent(filename)}`, { method: 'DELETE' })
    const newImages = imgs.filter((_, i) => i !== idx)
    setImages(newImages)
    setCurrentIndex(Math.min(idx, newImages.length - 1))
  }, [])

  // Save all annotated files to BASE_data/<timestamp>/
  const handleSaveForTraining = useCallback(async () => {
    setSaveForTrainingStatus('saving')
    try {
      const res = await fetch('/api/save-for-training', { method: 'POST' })
      const data = await res.json()
      if (data.status === 'ok') {
        setSaveForTrainingStatus('ok')
        const newImages = await fetch('/api/images').then(r => r.json())
        setImages(newImages)
        setCurrentIndex(0)
        setBoxes([])
        setTimeout(() => setSaveForTrainingStatus(null), 3000)
      } else if (data.status === 'nodata') {
        setSaveForTrainingStatus('nodata')
        setTimeout(() => setSaveForTrainingStatus(null), 3000)
      } else {
        setSaveForTrainingStatus('error')
        setTimeout(() => setSaveForTrainingStatus(null), 3000)
      }
    } catch {
      setSaveForTrainingStatus('error')
      setTimeout(() => setSaveForTrainingStatus(null), 3000)
    }
  }, [])

  // Restore last trashed image
  const undoDelete = useCallback(async () => {
    const res = await fetch('/api/undo-delete', { method: 'POST' })
    const data = await res.json()
    if (data.status === 'ok' && data.filename) {
      const newImages = await fetch('/api/images').then(r => r.json())
      setImages(newImages)
      const idx = newImages.indexOf(data.filename)
      if (idx !== -1) setCurrentIndex(idx)
    }
  }, [])

  // Load labels when current image changes (also clears undo/redo history)
  const currentImage = images[currentIndex]
  useEffect(() => {
    undoStackRef.current = []
    redoStackRef.current = []
    if (!currentImage) { setBoxes([]); return }
    fetch(`/api/labels/${encodeURIComponent(currentImage)}`)
      .then(r => r.json())
      .then(data => { setBoxes(data) })
      .catch(() => setBoxes([]))
  }, [currentImage])

  const saveBoxes = useCallback(async (filename, data) => {
    if (!filename) return
    try {
      await fetch(`/api/labels/${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setAnnotatedFiles(prev => ({ ...prev, [filename]: true }))
    } catch {
      // silent
    }
  }, [])

  const handleDeleteLabels = useCallback(async () => {
    const filename = imagesRef.current[currentIndexRef.current]
    if (!filename) return
    try {
      await fetch(`/api/labels/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      setAnnotatedFiles(prev => { const n = { ...prev }; delete n[filename]; return n })
    } catch {
      // silent
    }
  }, [])

  // ── Training polling ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!trainRunning) {
      if (trainPollRef.current) { clearInterval(trainPollRef.current); trainPollRef.current = null }
      return
    }
    trainPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/train/log?offset=${trainLogOffsetRef.current}`)
        const data = await res.json()
        if (data.lines.length > 0) {
          setTrainLogs(prev => [...prev, ...data.lines])
          trainLogOffsetRef.current = data.total
        }
        setTrainStatus(data.status)
        if (data.status !== 'running') {
          setTrainRunning(false)
        }
      } catch { /* silent */ }
    }, 1000)
    return () => { if (trainPollRef.current) { clearInterval(trainPollRef.current); trainPollRef.current = null } }
  }, [trainRunning])

  // Auto-scroll log to bottom whenever new lines arrive
  useEffect(() => {
    if (trainLogRef.current) {
      trainLogRef.current.scrollTop = trainLogRef.current.scrollHeight
    }
  }, [trainLogs])

  const handleTrainStart = useCallback(async () => {
    setTrainLogs([])
    trainLogOffsetRef.current = 0
    setTrainStatus('running')
    setTrainRunning(true)
    try {
      await fetch('/api/train/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trainConfig),
      })
    } catch (e) {
      setTrainLogs([`[error] ${e}`])
      setTrainStatus('error')
      setTrainRunning(false)
    }
  }, [trainConfig])

  const handleTrainStop = useCallback(async () => {
    await fetch('/api/train/stop', { method: 'POST' })
    setTrainRunning(false)
    setTrainStatus('stopped')
  }, [])

  // ── Predict helpers ────────────────────────────────────────────────────────
  const commitThresh = (raw, setter, inputSetter, storageKey) => {
    inputSetter(null)
    const v = parseFloat(raw)
    if (isNaN(v)) return
    const clamped = Math.min(0.999, Math.max(0.001, Math.round(v * 1000) / 1000))
    setter(clamped)
    localStorage.setItem(storageKey, clamped)
  }

  const handleDeleteRun = async (runName) => {
    await fetch(`/api/runs/${encodeURIComponent(runName)}`, { method: 'DELETE' })
    setPredictRuns(prev => prev.filter(r => r.name !== runName))
    if (selectedRun?.name === runName) {
      setSelectedRun(null)
      localStorage.removeItem('predict_run')
    }
    setDeleteConfirm(null)
    setDeleteInput('')
  }

  const openPredictSettings = async () => {
    setPredictOpen(true)
    setPredictRuns([])
    setPredictRunsLoading(true)
    try {
      const data = await fetch('/api/runs').then(r => r.json())
      setPredictRuns(data)
    } catch { /* silent */ }
    setPredictRunsLoading(false)
  }

  const handlePressP = useCallback(async () => {
    if (!currentImage || predicting || !selectedRun) return
    setPredicting(true)
    try {
      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: currentImage, weight: selectedRun.weight, conf, iou }),
      })
      const data = await res.json()
      if (data.status === 'ok') {
        setBoxes(data.boxes)
        await saveBoxes(currentImage, data.boxes)
      }
    } catch { /* silent */ }
    setPredicting(false)
  }, [currentImage, predicting, selectedRun, conf, iou, saveBoxes])

  // Push to undo history on box changes — no auto-save (Space to save explicitly)
  const handleBoxesChange = useCallback((newBoxes) => {
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), boxesRef.current]
    redoStackRef.current = []
    setBoxes(newBoxes)
  }, [])

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return
    const prevBoxes = undoStackRef.current[undoStackRef.current.length - 1]
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current.slice(-(MAX_HISTORY - 1)), boxesRef.current]
    setBoxes(prevBoxes)
    setSelIdx(null)
  }, [])

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return
    const nextBoxes = redoStackRef.current[redoStackRef.current.length - 1]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), boxesRef.current]
    setBoxes(nextBoxes)
    setSelIdx(null)
  }, [])

  // Navigate without auto-save — unsaved changes are discarded
  const goTo = useCallback((idx) => {
    const imgs = imagesRef.current
    if (idx < 0 || idx >= imgs.length) return
    setCurrentIndex(idx)
  }, [])

  // Skip to nearest unannotated image in given direction (-1 or +1)
  const goToNextUnannotated = useCallback((dir) => {
    const imgs = imagesRef.current
    const cur = currentIndexRef.current
    const start = cur + dir
    const end = dir === -1 ? -1 : imgs.length
    for (let i = start; i !== end; i += dir) {
      if (!annotatedFiles[imgs[i]]) { setCurrentIndex(i); return }
    }
  }, [annotatedFiles])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (predictOpen || trainOpen) return
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if      (e.key === ' ')          { e.preventDefault(); saveBoxes(imagesRef.current[currentIndexRef.current], boxesRef.current) }
      else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handlePressP() }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(currentIndexRef.current - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(currentIndexRef.current + 1) }
      else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const sel = selIdxRef.current
        if (sel !== null && boxesRef.current[sel]) {
          const ids = Object.keys(classNamesRef.current).map(Number).sort((a, b) => a - b)
          if (ids.length > 0) {
            const cur = boxesRef.current[sel].class_id
            const pos = ids.indexOf(cur)
            const nextId = ids[Math.min(ids.length - 1, pos === -1 ? 0 : pos + 1)]
            handleBoxesChange(boxesRef.current.map((b, i) => i === sel ? { ...b, class_id: nextId } : b))
            setClassId(nextId)
          }
        } else {
          setClassId(p => Math.min(9, p + 1))
        }
      }
      else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const sel = selIdxRef.current
        if (sel !== null && boxesRef.current[sel]) {
          const ids = Object.keys(classNamesRef.current).map(Number).sort((a, b) => a - b)
          if (ids.length > 0) {
            const cur = boxesRef.current[sel].class_id
            const pos = ids.indexOf(cur)
            const nextId = ids[Math.max(0, pos === -1 ? 0 : pos - 1)]
            handleBoxesChange(boxesRef.current.map((b, i) => i === sel ? { ...b, class_id: nextId } : b))
            setClassId(nextId)
          }
        } else {
          setClassId(p => Math.max(0, p - 1))
        }
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey && e.ctrlKey) { e.preventDefault(); undoDelete() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) { e.preventDefault(); deleteCurrentImage() }
      else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)  { e.preventDefault(); handleRedo() }
      else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo() }
      else if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const sel = selIdxRef.current
        if (sel !== null && boxesRef.current[sel]) {
          e.preventDefault()
          const data = { box: boxesRef.current[sel], source_image: imagesRef.current[currentIndexRef.current] }
          setClipboardData(data)
          clipboardDataRef.current = data
          fetch('/api/clipboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          }).catch(() => {})
        }
      }
      else if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const cb = clipboardDataRef.current
        if (!cb?.box) return
        e.preventDefault()
        const PASTE_OFFSET = 0.02
        const currentImg = imagesRef.current[currentIndexRef.current]
        let newBox
        if (currentImg === cb.source_image) {
          const { box } = cb
          newBox = {
            ...box,
            x: Math.min(1 - box.w / 2, Math.max(box.w / 2, box.x + PASTE_OFFSET)),
            y: Math.min(1 - box.h / 2, Math.max(box.h / 2, box.y + PASTE_OFFSET)),
          }
        } else {
          newBox = { ...cb.box }
        }
        handleBoxesChange([...boxesRef.current, newBox])
      }
      else if (e.key >= '0' && e.key <= '9') setClassId(+e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, deleteCurrentImage, undoDelete, handleBoxesChange, handleUndo, handleRedo, saveBoxes, handlePressP, predictOpen, trainOpen])

  const sortedClasses = Object.entries(classNames)
    .map(([id, name]) => ({ id: +id, name }))
    .sort((a, b) => a.id - b.id)

  if (loading) {
    return <div className="center-msg"><p>Loading images...</p></div>
  }

  if (!images.length) {
    return (
      <div className="center-msg">
        <h2>No images found</h2>
        <p>Add images to the to_annotate/images/ folder and refresh.</p>
      </div>
    )
  }

  return (
    <div className="app">
      <ThumbnailStrip
        images={images}
        currentIndex={currentIndex}
        onSelect={goTo}
        annotatedFiles={annotatedFiles}
      />
      <div className="workspace">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-resize-handle" onMouseDown={handleResizeMouseDown} />

          {/* ── Scrollable: Classes + Shortcuts ── */}
          <div className="sidebar-scroll">

          {/* ── Classes ── */}
          <div className="class-section">
            <div className="section-title">Classes</div>
            <div className="active-class-badge">
              <span className="active-class-num">{classId}</span>
              <span className="active-class-name">{classNames[classId] ?? '—'}</span>
            </div>
            <div className="class-list">
              {sortedClasses.map(({ id, name }) => (
                <div
                  key={id}
                  className={`class-item ${id === classId ? 'active' : ''}`}
                  onClick={() => {
                    setClassId(id)
                    if (selIdx !== null) {
                      handleBoxesChange(boxes.map((b, i) => i === selIdx ? { ...b, class_id: id } : b))
                    }
                  }}
                >
                  <span className="class-id-pill">{id}</span>
                  {editingClassId === id ? (
                    <input
                      className="class-name-input"
                      value={editingValue}
                      autoFocus
                      onChange={e => setEditingValue(e.target.value)}
                      onBlur={() => commitEdit(id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  commitEdit(id)
                        if (e.key === 'Escape') { setEditingClassId(null); setEditingValue('') }
                        e.stopPropagation()
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="class-name" title={name}>{name}</span>
                  )}
                  <div className="class-actions">
                    <button
                      className="color-swatch-btn"
                      style={{ background: classColors[id] ?? DEFAULT_COLORS[id % DEFAULT_COLORS.length] }}
                      title="Change color"
                      onClick={e => {
                        e.stopPropagation()
                        if (colorPickerOpen?.id === id) { setColorPickerOpen(null); return }
                        const rect = e.currentTarget.getBoundingClientRect()
                        setColorPickerOpen({ id, top: rect.top, left: rect.right + 6 })
                      }}
                    />
                    <button
                      className="icon-btn"
                      title="Edit name"
                      onClick={e => { e.stopPropagation(); startEdit(id, name) }}
                    >✏</button>
                    <button
                      className="icon-btn delete"
                      title="Delete"
                      onClick={e => { e.stopPropagation(); deleteClass(id) }}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
            <button className="add-class-btn" onClick={addClass}>+ Add Class</button>
          </div>

          {/* ── Shortcuts ── */}
          <div className="shortcuts-section">
            <div className="section-title">Shortcuts</div>
            <div className="shortcuts">
              <div><span className="sc-keys"><kbd>0</kbd>–<kbd>9</kbd></span><span className="sc-desc">select class</span></div>
              <div><span className="sc-keys"><kbd>↓</kbd><kbd>↑</kbd></span><span className="sc-desc">class ±1</span></div>
              <div><span className="sc-keys"><kbd>←</kbd><kbd>→</kbd></span><span className="sc-desc">prev / next image</span></div>
              <div><span className="sc-keys"><kbd>Del</kbd></span><span className="sc-desc">delete box</span></div>
              <div><span className="sc-keys"><kbd>Shift</kbd>+<kbd>Del</kbd></span><span className="sc-desc">delete file</span></div>
              <div><span className="sc-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Del</kbd></span><span className="sc-desc">undo delete</span></div>
              <div><span className="sc-keys"><kbd>Click</kbd></span><span className="sc-desc">select box</span></div>
              <div><span className="sc-keys"><kbd>Ctrl</kbd>+<kbd>C</kbd></span><span className="sc-desc">copy box</span></div>
              <div><span className="sc-keys"><kbd>Ctrl</kbd>+<kbd>V</kbd></span><span className="sc-desc">paste box</span></div>
              <div><span className="sc-keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd></span><span className="sc-desc">undo</span></div>
              <div><span className="sc-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></span><span className="sc-desc">redo</span></div>
            </div>
          </div>

          </div>{/* /sidebar-scroll */}

          <div className="sidebar-divider" />

          {/* ── Predict + Training buttons ── */}
          <div className="predict-sidebar-section">
            <div className="predict-train-row">
              <button className="predict-settings-btn" onClick={openPredictSettings}>Set Model</button>
              <button className="train-open-btn" onClick={() => setTrainOpen(true)}>Training</button>
            </div>
            <div className="predict-sidebar-meta">
              {selectedRun
                ? <span className="predict-selected-label" title={selectedRun.name}>{selectedRun.name} · {selectedRun.weight_type}</span>
                : <span className="predict-no-model">모델 미선택</span>
              }
              {predicting && <span className="predict-running">예측 중…</span>}
            </div>
          </div>

          {/* ── Zoom Controls ── */}
          <div className="zoom-section">
            <div className="section-title">Zoom</div>
            <div className="zoom-controls">
              <button
                className="zoom-btn"
                disabled={zoomLevel <= 0.25}
                title="Zoom out (scroll ↓)"
                onClick={() => canvasControlsRef.current?.zoomOut()}
              >−</button>
              <span
                className="zoom-label"
                title="Click to reset"
                onClick={() => canvasControlsRef.current?.resetZoom()}
              >{Math.round(zoomLevel * 100)}%</span>
              <button
                className="zoom-btn"
                disabled={zoomLevel >= 10.0}
                title="Zoom in (scroll ↑)"
                onClick={() => canvasControlsRef.current?.zoomIn()}
              >+</button>
              <button
                className="zoom-fit-btn"
                title="Fit to screen"
                onClick={() => canvasControlsRef.current?.resetZoom()}
              >Fit</button>
            </div>
          </div>

          {/* ── File Info ── */}
          <div className="info-section">
            <div className="img-counter">{currentIndex + 1} / {images.length}</div>
            <div className="info-row">
              <span className="info-bullet">•</span>
              <span className="info-key">File</span>
              <span className="info-file" title={currentImage}>{currentImage}</span>
            </div>
            <div className="info-row">
              <span className="info-bullet">•</span>
              <span className="info-boxes">{boxes.length} Boxes</span>
            </div>
          </div>

          {/* ── Save for Training ── */}
          <div className="train-save-section">
            <button
              className={`train-save-btn ${saveForTrainingStatus || ''}`}
              onClick={handleSaveForTraining}
              disabled={saveForTrainingStatus === 'saving'}
            >
              {saveForTrainingStatus === 'saving' && 'Saving...'}
              {saveForTrainingStatus === 'ok'     && '✓ Saved'}
              {saveForTrainingStatus === 'nodata' && 'No Training Data'}
              {saveForTrainingStatus === 'error'  && '✗ Error'}
              {!saveForTrainingStatus             && 'Save for Training'}
            </button>
          </div>

        </aside>
        <div className="canvas-nav-wrapper">
          <button className="canvas-nav-btn canvas-nav-prev" onClick={() => goToNextUnannotated(-1)}>‹</button>
          <AnnotationCanvas
            imageFile={currentImage}
            boxes={boxes}
            onBoxesChange={handleBoxesChange}
            classId={classId}
            classNames={classNames}
            classColors={classColors}
            selIdx={selIdx}
            onSelectionChange={setSelIdx}
            controlsRef={canvasControlsRef}
            onZoomChange={setZoomLevel}
            onDeleteLabels={handleDeleteLabels}
          />
          <button className="canvas-nav-btn canvas-nav-next" onClick={() => goToNextUnannotated(1)}>›</button>
        </div>
      </div>

      {/* ── Predict Settings Modal ── */}
      {predictOpen && (
        <div className="predict-overlay" onClick={() => setPredictOpen(false)}>
          <div className="predict-modal" onClick={e => e.stopPropagation()}>
            <div className="predict-modal-header">
              <span>Predict Settings</span>
              <button className="predict-close-btn" onClick={() => setPredictOpen(false)}>✕</button>
            </div>

            <div className="predict-thresh">
              <div className="predict-thresh-row">
                <span className="predict-thresh-label">Conf</span>
                <input
                  type="range" min="0.001" max="0.999" step="0.001"
                  value={conf}
                  onChange={e => { const v = parseFloat(e.target.value); setConf(v); setConfInput(null); localStorage.setItem('predict_conf', v) }}
                  className="predict-thresh-slider"
                />
                <input
                  type="number" min="0.001" max="0.999" step="0.001"
                  value={confInput !== null ? confInput : conf.toFixed(3)}
                  onChange={e => {
                    setConfInput(e.target.value)
                    const v = parseFloat(e.target.value)
                    if (!isNaN(v) && v >= 0.001 && v <= 0.999) { setConf(Math.round(v * 1000) / 1000); localStorage.setItem('predict_conf', v) }
                  }}
                  onBlur={() => commitThresh(confInput ?? conf, setConf, setConfInput, 'predict_conf')}
                  onKeyDown={e => e.key === 'Enter' && commitThresh(confInput ?? conf, setConf, setConfInput, 'predict_conf')}
                  className="predict-thresh-val predict-thresh-input"
                />
              </div>
              <div className="predict-thresh-row">
                <span className="predict-thresh-label">IoU</span>
                <input
                  type="range" min="0.001" max="0.999" step="0.001"
                  value={iou}
                  onChange={e => { const v = parseFloat(e.target.value); setIou(v); setIouInput(null); localStorage.setItem('predict_iou', v) }}
                  className="predict-thresh-slider"
                />
                <input
                  type="number" min="0.001" max="0.999" step="0.001"
                  value={iouInput !== null ? iouInput : iou.toFixed(3)}
                  onChange={e => {
                    setIouInput(e.target.value)
                    const v = parseFloat(e.target.value)
                    if (!isNaN(v) && v >= 0.001 && v <= 0.999) { setIou(Math.round(v * 1000) / 1000); localStorage.setItem('predict_iou', v) }
                  }}
                  onBlur={() => commitThresh(iouInput ?? iou, setIou, setIouInput, 'predict_iou')}
                  onKeyDown={e => e.key === 'Enter' && commitThresh(iouInput ?? iou, setIou, setIouInput, 'predict_iou')}
                  className="predict-thresh-val predict-thresh-input"
                />
              </div>
            </div>

            <div className="predict-run-list">
              {predictRunsLoading && <div className="predict-status">모델 목록 불러오는 중...</div>}
              {!predictRunsLoading && predictRuns.length === 0 && (
                <div className="predict-no-runs">
                  <p>No trained models found.</p>
                  <p>Please run training first.</p>
                </div>
              )}
              {!predictRunsLoading && predictRuns.map(run => (
                <div key={run.name} className="predict-run-row">
                  <div
                    className={`predict-run-item${selectedRun?.name === run.name ? ' selected' : ''}`}
                    onClick={() => { setSelectedRun(run); localStorage.setItem('predict_run', JSON.stringify(run)) }}
                  >
                    <span className="predict-run-name">{run.name}</span>
                    <span className="predict-run-badge">{run.weight_type}</span>
                    <a
                      className="predict-download-btn"
                      href={`/api/download-weight?path=${encodeURIComponent(run.weight)}`}
                      download
                      onClick={e => e.stopPropagation()}
                      title={`Download ${run.weight_type}.pt`}
                    >↓</a>
                    <button
                      className="predict-delete-btn"
                      onClick={e => { e.stopPropagation(); setDeleteConfirm(run.name); setDeleteInput('') }}
                      title="Delete run folder"
                    >✕</button>
                  </div>
                  {deleteConfirm === run.name && (
                    <div className="predict-delete-confirm">
                      <span>type <b>del</b> to delete</span>
                      <input
                        autoFocus
                        className="predict-delete-input"
                        value={deleteInput}
                        onChange={e => setDeleteInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && deleteInput === 'del') handleDeleteRun(run.name)
                          if (e.key === 'Escape') { setDeleteConfirm(null); setDeleteInput('') }
                        }}
                        placeholder="del"
                      />
                      <button
                        className="predict-delete-ok"
                        disabled={deleteInput !== 'del'}
                        onClick={() => handleDeleteRun(run.name)}
                      >Delete</button>
                      <button
                        className="predict-delete-cancel"
                        onClick={() => { setDeleteConfirm(null); setDeleteInput('') }}
                      >Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="predict-modal-footer">
              <span className="predict-hint">모델 선택 후 P키로 예측</span>
              <button className="predict-done-btn" onClick={() => setPredictOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Training Modal ── */}
      {trainOpen && (
        <div className="train-overlay" onClick={() => { if (!trainRunning) setTrainOpen(false) }}>
          <div className="train-modal" onClick={e => e.stopPropagation()}>
            <div className="train-modal-header">
              <span>Training</span>
              <button
                className="predict-close-btn"
                onClick={() => { if (!trainRunning) setTrainOpen(false) }}
                disabled={trainRunning}
              >✕</button>
            </div>

            {/* Config */}
            <div className="train-config">

              {/* Model */}
              <div className="train-section-title">Base Model</div>
              <div className="train-option-list">
                {MODEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`train-option-card${(trainConfig.model ?? 'yolo12n.pt') === opt.value ? ' selected' : ''}`}
                    disabled={trainRunning}
                    onClick={() => setTrainConfig(p => ({ ...p, model: opt.value }))}
                  >
                    <span className="train-option-label">{opt.label}</span>
                    <span className="train-option-desc">{opt.desc}</span>
                  </button>
                ))}
              </div>

              {/* Numeric params */}
              <div className="train-section-title">Parameters</div>
              <div className="train-num-grid">
                {[
                  { label: 'Epochs',   key: 'epochs',    def: 100, desc: '데이터 전체를 학습하는 반복 횟수 · 클수록 정확하지만 오래 걸림' },
                  { label: 'Patience', key: 'patience',  def: 20,  desc: '성능 개선이 없을 때 자동 종료까지 기다리는 에폭 수 (0 = 끄기)' },
                  { label: 'Img Size', key: 'imgSize',   def: 640, desc: '학습 이미지 크기(픽셀) · 클수록 정확하지만 속도·메모리 증가' },
                  { label: 'Batch',    key: 'batchSize', def: 16,  desc: '한 번에 처리할 이미지 수 · 클수록 빠르지만 메모리 많이 사용' },
                ].map(({ label, key, def, desc }) => (
                  <div key={key} className="train-num-field">
                    <div className="train-num-top">
                      <label className="train-num-label">{label}</label>
                      <input
                        className="train-config-input train-num-input"
                        type="number"
                        value={trainConfig[key] !== undefined ? trainConfig[key] : def}
                        disabled={trainRunning}
                        onChange={e => setTrainConfig(p => ({ ...p, [key]: +e.target.value }))}
                        onKeyDown={e => e.stopPropagation()}
                      />
                    </div>
                    <div className="train-num-desc">{desc}</div>
                  </div>
                ))}
              </div>

              {/* Device */}
              <div className="train-section-title">Device</div>
              <div className="train-device-row">
                {DEVICE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`train-device-btn${(trainConfig.device ?? '') === opt.value ? ' selected' : ''}`}
                    disabled={trainRunning}
                    onClick={() => setTrainConfig(p => ({ ...p, device: opt.value }))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

            </div>

            {/* Log output */}
            {trainLogs.length > 0 && (
              <div className="train-log" ref={trainLogRef}>
                {trainLogs.map((line, i) => (
                  <div key={i} className="train-log-line">{line || '\u00a0'}</div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="train-modal-footer">
              {!trainRunning && trainStatus === 'idle' && (
                <button className="train-start-btn" onClick={handleTrainStart}>▶ Start</button>
              )}
              {trainRunning && (
                <>
                  <span className="train-status-running">Training…</span>
                  <button className="train-stop-btn" onClick={handleTrainStop}>■ Stop</button>
                </>
              )}
              {!trainRunning && trainStatus === 'done' && (
                <>
                  <span className="train-status-done">✓ Done</span>
                  <button className="train-start-btn" onClick={handleTrainStart}>▶ Run Again</button>
                </>
              )}
              {!trainRunning && trainStatus === 'error' && (
                <>
                  <span className="train-status-error">✗ Error</span>
                  <button className="train-start-btn" onClick={handleTrainStart}>▶ Retry</button>
                </>
              )}
              {!trainRunning && trainStatus === 'stopped' && (
                <>
                  <span className="train-status-stopped">Stopped</span>
                  <button className="train-start-btn" onClick={handleTrainStart}>▶ Run Again</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {colorPickerOpen && (
        <>
          <div className="color-palette-backdrop" onClick={() => setColorPickerOpen(null)} />
          <div
            className="color-palette"
            style={{ top: colorPickerOpen.top, left: colorPickerOpen.left }}
          >
            {PALETTE_COLORS.map(color => (
              <button
                key={color}
                className={`palette-color${classColors[colorPickerOpen.id] === color ? ' active' : ''}`}
                style={{ background: color }}
                onClick={() => {
                  setClassColors(prev => ({ ...prev, [colorPickerOpen.id]: color }))
                  setColorPickerOpen(null)
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
