import Link from "next/link";
import { signInAction } from "./actions";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action={signInAction} className="mx-auto max-w-sm space-y-3 p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <input name="email" type="email" required placeholder="Email" className="w-full border p-2" />
      <input name="password" type="password" required placeholder="Password" className="w-full border p-2" />
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">Sign in</button>
      <p className="text-sm">No account? <Link href="/sign-up" className="underline">Sign up</Link></p>
    </form>
  );
}
