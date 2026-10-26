"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sortMaterialImages } from "@/lib/client/material-image-files"

export type ImageUploadChoice = { files: File[]; combined: boolean; name: string }

function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState("")
  useEffect(() => {
    const value = URL.createObjectURL(file)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [file])
  return <img src={url || undefined} alt="" className="h-12 w-12 shrink-0 rounded object-contain" />
}

export function useMaterialImagesDialog() {
  const [files, setFiles] = useState<File[] | null>(null)
  const [combined, setCombined] = useState(false)
  const [name, setName] = useState("Apuntes")
  const dragged = useRef<number | null>(null)
  const resolver = useRef<((value: ImageUploadChoice | null) => void) | null>(null)
  useEffect(() => () => { resolver.current?.(null) }, [])

  const choose = (images: File[]) => {
    // Keep a pending batch intact if a second drop occurs while choosing.
    if (resolver.current) return Promise.resolve(null)
    setFiles(sortMaterialImages(images))
    setCombined(false)
    setName("Apuntes")
    return new Promise<ImageUploadChoice | null>(resolve => { resolver.current = resolve })
  }
  const finish = (value: ImageUploadChoice | null) => {
    resolver.current?.(value)
    resolver.current = null
    setFiles(null)
  }
  const move = (from: number, to: number) => setFiles(previous => {
    if (!previous || to < 0 || to >= previous.length) return previous
    const next = [...previous]
    next.splice(to, 0, next.splice(from, 1)[0])
    return next
  })

  const dialog = <Dialog open={files !== null} onOpenChange={open => { if (!open) finish(null) }}>
    <DialogContent aria-describedby={undefined} className="max-w-md">
      <DialogTitle>Imágenes a PDF</DialogTitle>
      <div className="flex gap-2">
        <Button variant={combined ? "outline" : "default"} aria-pressed={!combined} onClick={() => setCombined(false)}>Un PDF por imagen</Button>
        <Button variant={combined ? "default" : "outline"} aria-pressed={combined} onClick={() => setCombined(true)}>Unir en PDF</Button>
      </div>
      {combined && <>
        <Input aria-label="Nombre del PDF" value={name} onChange={event => setName(event.target.value)} />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {files?.map((file, index) => <div key={`${file.name}-${file.lastModified}-${file.size}-${index}`} draggable onDragStart={event => { dragged.current = index; event.dataTransfer.setData("text/plain", String(index)) }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragged.current !== null) move(dragged.current, index); dragged.current = null }} onDragEnd={() => { dragged.current = null }} className="flex items-center gap-2 rounded border p-2">
            <GripVertical aria-hidden className="h-4 w-4 shrink-0 cursor-grab" />
            <Thumbnail file={file} />
            <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>{file.name}</span>
            <Button size="icon" variant="ghost" disabled={index === 0} aria-label={`Subir ${file.name}`} onClick={() => move(index, index - 1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" disabled={index === files.length - 1} aria-label={`Bajar ${file.name}`} onClick={() => move(index, index + 1)}><ArrowDown className="h-4 w-4" /></Button>
          </div>)}
        </div>
      </>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => finish(null)}>Cancelar</Button>
        <Button disabled={combined && !name.trim()} onClick={() => files && finish({ files, combined, name })}>Subir</Button>
      </div>
    </DialogContent>
  </Dialog>
  return { choose, dialog }
}
