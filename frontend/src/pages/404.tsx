import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary">
      <h1 className="text-5xl font-bold text-error mb-4">404</h1>
      <p className="text-xl text-secondary">Page Not Found</p>
      <Link href="/" className="mt-6 text-accent underline">Go Home</Link>
    </div>
  )
} 