export default function ThemePreview() {
  return (
    <div className="flex gap-4 mt-8">
      <div className="w-16 h-16 bg-primary border text-xs flex items-center justify-center">primary</div>
      <div className="w-16 h-16 bg-accent border text-xs flex items-center justify-center">accent</div>
      <div className="w-16 h-16 bg-secondary border text-xs flex items-center justify-center">secondary</div>
      <div className="w-16 h-16 bg-success border text-xs flex items-center justify-center">success</div>
      <div className="w-16 h-16 bg-error border text-xs flex items-center justify-center">error</div>
    </div>
  )
} 