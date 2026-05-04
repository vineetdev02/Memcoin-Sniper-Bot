import { SocketProvider } from "@/components/SocketProvider";
import { Header } from "@/components/Header";
import { BankrollBar } from "@/components/BankrollBar";
import { PositionsTable } from "@/components/PositionsTable";

export default function PositionsPage() {
  return (
    <SocketProvider>
      <Header />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
        <BankrollBar />
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">Open positions</h1>
          <span className="text-xs text-fg-subtle">live updates · 1s tick</span>
        </div>
        <PositionsTable />
      </main>
    </SocketProvider>
  );
}
