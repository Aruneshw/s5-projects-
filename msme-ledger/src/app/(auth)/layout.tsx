// src/app/(auth)/layout.tsx — centered card layout for sign-in and recovery screens.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-leaf-700 text-2xl font-black text-white">₹</div>
          <h1 className="text-2xl font-extrabold">MSME Ledger</h1>
          <p className="text-sm text-muted">Vegetable trading · Tamil Nadu ⇄ Kerala</p>
        </div>
        {children}
      </div>
    </main>
  );
}
