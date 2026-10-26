/** Small deterministic PDFs with differently sized, colored pages; no external generator. */
export function pdfFixture(count = 20) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const kids = []
  for (let i = 0; i < count; i++) {
    const width = i % 2 ? 420 : 612, height = i % 2 ? 595 : 792
    const contentId = objects.length, pageId = contentId + 1
    const content = `q ${i % 2 ? '0 0 1' : '1 0 0'} rg 0 0 ${width} ${height} re f Q\nBT /F1 24 Tf 1 1 1 rg 40 ${height - 60} Td (PAGE ${i + 1}) Tj ET\n`
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    kids.push(`${pageId} 0 R`)
  }
  objects[2] = `<< /Type /Pages /Count ${count} /Kids [${kids.join(' ')}] >>`
  let text = '%PDF-1.4\n', offsets = [0]
  for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i} 0 obj\n${objects[i]}\nendobj\n` }
  const start = Buffer.byteLength(text)
  text += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(text)
}
