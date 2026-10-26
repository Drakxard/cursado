export function isMaterialImage(file: File) {
  return /\.(jpe?g|png|webp)$/i.test(file.name) || /^(image\/jpeg|image\/png|image\/webp)$/.test(file.type)
}

export function sortMaterialImages(files: File[]) {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" }))
}
