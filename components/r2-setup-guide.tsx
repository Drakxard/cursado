'use client'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, X } from 'lucide-react'

const steps = [
  { title: 'Elegí tu bucket', description: 'Entrá a Cloudflare y abrí R2 Object Storage. Si ya tenés un bucket para tus materias, usá ese. Si no, creá uno y anotá su nombre. Puede seguir siendo privado.', link: 'https://developers.cloudflare.com/r2/buckets/create-buckets/' },
  { title: 'Creá las claves de R2', description: 'En el inicio de R2 buscá API Tokens → Manage y creá un token de cuenta o usuario. Elegí Object Read & Write y limitá el acceso al bucket de tus materias.', link: 'https://developers.cloudflare.com/r2/api/tokens/' },
  { title: 'Copiá los datos para S3', description: 'Al crear el token, Cloudflare muestra Access Key ID, Secret Access Key y el endpoint S3. Copialos en los campos del mismo nombre de Cursado. En Bucket va el nombre del paso 1. Guardá las claves: Secret Access Key se muestra solo al crearla.', link: 'https://developers.cloudflare.com/r2/get-started/s3/' },
  { title: 'Permití las subidas desde esta web', description: 'En tu bucket abrí Settings → CORS policy → Add CORS policy (o Edit) y pegá esta regla en la pestaña JSON. Si ya hay reglas para otras apps, conservá esas reglas y agregá esta. Pulsá Save y esperá hasta 30 segundos. Volvé a Cursado y reintentá la publicación sin cambiar las claves. Al terminar aparecerá el QR para InScreen.', link: 'https://developers.cloudflare.com/r2/buckets/cors/' },
]

function R2Illustration({ step }: { step: number }) {
  return <figure className="r2-guide-figure"><svg viewBox="0 0 680 290" role="img" aria-label={`Ilustración: ${steps[step].title}`}>
    <rect x="1" y="1" width="678" height="288" rx="15" fill="#fff" stroke="#d7dce3" />
    <path d="M16 1h648a15 15 0 0 1 15 15v27H1V16A15 15 0 0 1 16 1" fill="#f3f5f8" />
    <circle cx="22" cy="22" r="5" fill="#f0aa83" /><circle cx="39" cy="22" r="5" fill="#e8cd7c" /><circle cx="56" cy="22" r="5" fill="#9cceae" />
    <text x="90" y="28" fontSize="15" fill="#536174">Cloudflare · R2</text>
    <rect x="14" y="58" width="122" height="216" rx="9" fill="#f6f7f9" />
    <text x="29" y="88" fontSize="14" fontWeight="600" fill="#58667a">Tu cuenta</text>
    <rect x="21" y="105" width="108" height="33" rx="6" fill="#fff1e8" /><text x="33" y="127" fontSize="16" fontWeight="700" fill="#b64e0e">R2</text>
    <text x="29" y="164" fontSize="13" fill="#728097">Overview</text><text x="29" y="194" fontSize="13" fill="#728097">Settings</text>
    {step === 0 && <><text x="163" y="85" fontSize="21" fontWeight="600" fill="#182235">Tus buckets</text><rect x="499" y="63" width="153" height="39" rx="8" fill="#ed781f" /><text x="575" y="88" textAnchor="middle" fill="white" fontSize="14" fontWeight="600">+ Create bucket</text><rect x="162" y="127" width="490" height="112" rx="10" fill="#fdfaf6" stroke="#efb078" strokeWidth="2" /><text x="183" y="158" fontSize="13" fill="#5d6a7e">Nombre del bucket</text><text x="183" y="191" fontSize="23" fill="#182235">mis-materias</text><text x="183" y="218" fontSize="13" fill="#68816e">Privado · No hace falta habilitar acceso público</text></>}
    {step === 1 && <><text x="163" y="85" fontSize="21" fontWeight="600" fill="#182235">Crear token de R2</text><rect x="162" y="104" width="490" height="69" rx="10" fill="#fff7ef" stroke="#ed913e" strokeWidth="2" /><circle cx="188" cy="137" r="9" fill="#ed781f" /><circle cx="188" cy="137" r="4" fill="white" /><text x="209" y="142" fontSize="19" fontWeight="600" fill="#182235">Object Read &amp; Write</text><text x="163" y="202" fontSize="14" fill="#5d6a7e">Aplicar únicamente a este bucket</text><rect x="162" y="216" width="490" height="40" rx="8" fill="#f3f5f8" /><text x="183" y="242" fontSize="17" fill="#182235">mis-materias</text><path d="m619 231 7 7 7-7" fill="none" stroke="#728097" strokeWidth="2" /></>}
    {step === 2 && <>{['Access Key ID', 'Secret Access Key', 'Endpoint S3'].map((label, i) => <g key={label}><text x="163" y={79 + i * 69} fontSize="14" fontWeight="600" fill="#536174">{label}</text><rect x="162" y={89 + i * 69} width="490" height="37" rx="7" fill={i === 2 ? '#fff7ef' : '#f4f6f9'} stroke={i === 2 ? '#ed913e' : '#dde2e9'} /><text x="176" y={113 + i * 69} fontSize={i === 2 ? 13 : 15} fill="#182235">{i === 2 ? 'https://TU_ACCOUNT_ID.r2.cloudflarestorage.com' : i === 1 ? '••••••••••••••••••••••••' : 'Copiá el valor que te muestra Cloudflare'}</text></g>)}</>}
    {step === 3 && <><text x="163" y="85" fontSize="21" fontWeight="600" fill="#182235">mis-materias · Settings</text><rect x="162" y="105" width="490" height="149" rx="10" fill="#f5f7fa" /><text x="182" y="137" fontSize="19" fontWeight="600" fill="#182235">CORS policy</text><text x="182" y="170" fontSize="14" fill="#5d6a7e">Permití el origen de Cursado</text><rect x="182" y="190" width="173" height="40" rx="8" fill="#ed781f" /><text x="268" y="216" textAnchor="middle" fontSize="15" fontWeight="600" fill="white">Add CORS policy</text><path d="m397 198 16 16 31-35" fill="none" stroke="#359f6a" strokeWidth="5" strokeLinecap="round" /></>}
  </svg><figcaption>Ilustración orientativa · Los nombres pueden variar según el idioma de Cloudflare.</figcaption></figure>
}

export function R2SetupGuide({ open, onOpenChange, initialStep = 0 }: { open: boolean; onOpenChange: (open: boolean) => void; initialStep?: number }) {
  const [step, setStep] = useState(0), [copied, setCopied] = useState(false)
  useEffect(() => { if (open) { setStep(Math.max(0, Math.min(steps.length - 1, initialStep))); setCopied(false) } }, [open, initialStep])
  const cors = JSON.stringify([{ AllowedOrigins: [typeof window !== 'undefined' ? window.location.origin : 'https://cursado.vercel.app'], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['content-type', 'x-amz-*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }], null, 2)
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="r2-guide-overlay" /><Dialog.Content className="r2-guide" onEscapeKeyDown={event => event.stopPropagation()}>
    <div className="r2-guide-heading"><div><span className="r2-guide-eyebrow">AYUDA PARA CONECTAR R2</span><Dialog.Title>Paso {step + 1} de {steps.length} · {steps[step].title}</Dialog.Title></div><Dialog.Close className="r2-guide-close" aria-label="Cerrar guía de R2"><X size={22} /></Dialog.Close></div>
    <nav aria-label="Pasos para conectar R2" className="r2-guide-steps">{steps.map((s, i) => <button key={s.title} aria-label={`Paso ${i + 1}: ${s.title}`} aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}>{i < step ? <Check size={16} /> : i + 1}<span>{s.title}</span></button>)}</nav>
    <Dialog.Description>{steps[step].description}</Dialog.Description>
    <R2Illustration step={step} />
    {step === 3 && <div className="r2-guide-cors"><div><strong>Configuración para esta web</strong><button onClick={() => { void navigator.clipboard.writeText(cors).then(() => setCopied(true)).catch(() => setCopied(false)) }}><Copy size={16} />{copied ? 'Copiado' : 'Copiar JSON'}</button></div><pre tabIndex={0}>{cors}</pre></div>}
    <a href={steps[step].link} target="_blank" rel="noopener noreferrer" className="r2-guide-docs">Ver este paso en la documentación oficial <ExternalLink size={15} /></a>
    <footer><button disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={17} />Anterior</button><button className="r2-guide-next" onClick={() => step === steps.length - 1 ? onOpenChange(false) : setStep(step + 1)}>{step === steps.length - 1 ? 'Listo, volver a Cursado' : 'Siguiente'}<ArrowRight size={17} /></button></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
