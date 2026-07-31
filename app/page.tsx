import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', padding: '0 1rem' }}>
      <h1>Order Management Tool</h1>
      <p>The Next.js app is scaffolded and ready for Supabase-backed order workflows.</p>
      <p>Use the health check endpoint to verify the database connection once the environment variables are configured.</p>
      <Link href="/orders" className="nav-pill">Go to orders</Link>
    </main>
  );
}
