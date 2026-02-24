import { useEffect, useRef } from 'react'

const MIN_SLOTS = 15

export default function ThumbnailStrip({ images, currentIndex, onSelect, annotatedFiles = {} }) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [currentIndex])

  const placeholderCount = Math.max(0, MIN_SLOTS - images.length)

  return (
    <div className="thumbnail-strip">
      {images.map((img, idx) => (
        <div
          key={img}
          ref={idx === currentIndex ? activeRef : null}
          className={`thumb${idx === currentIndex ? ' active' : ''}`}
          onClick={() => onSelect(idx)}
          title={`[${idx + 1}] ${img}`}
        >
          <img
            src={`/api/images/${encodeURIComponent(img)}`}
            alt={img}
            loading="lazy"
          />
          <div className="thumb-idx">{idx + 1}</div>
          {annotatedFiles[img] && (
            <div className="thumb-check-badge">
              <svg viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5.2" fill="rgba(0,0,0,0.65)" stroke="#3dffb4" strokeWidth="1.4"/>
                <path d="M3.2 6 L5.1 8 L8.8 4" stroke="#3dffb4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </div>
      ))}
      {Array.from({ length: placeholderCount }, (_, i) => (
        <div key={`empty-${i}`} className="thumb thumb-empty">
          <svg viewBox="0 0 3 2" preserveAspectRatio="none" className="thumb-empty-svg">
            <line x1="0" y1="2" x2="3" y2="0" stroke="#3a4154" strokeWidth="0.03" />
          </svg>
        </div>
      ))}
    </div>
  )
}
