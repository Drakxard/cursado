import type { ButtonHTMLAttributes } from 'react'
import './subject-home-card.css'

export function SubjectHomeCard({ displayName, daysRemainingLabel, color, ...button }: ButtonHTMLAttributes<HTMLButtonElement> & { displayName: string; daysRemainingLabel: string; color: string }) {
  return <button {...button} type="button" className={`subject-home-card ${button.className || ''}`} style={{ ...button.style, backgroundColor: color }}>
    <span className="subject-home-card-countdown">{daysRemainingLabel}</span>
    <span className="subject-home-card-name">{displayName}</span>
    <span aria-hidden="true" className="subject-home-card-space"></span>
  </button>
}
