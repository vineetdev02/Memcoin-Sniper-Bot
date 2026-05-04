import { SocketProvider } from "@/components/SocketProvider";
import { Header } from "@/components/Header";
import { BankrollBar } from "@/components/BankrollBar";
import { HistoryTable } from "@/components/HistoryTable";

export default function HistoryPage() {
  return (
    <SocketProvider>
      <Header />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
        <BankrollBar />
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">Trade history</h1>
          <span className="text-xs text-fg-subtle">last 50 closed positions</span>
        </div>
        <HistoryTable />
      </main>
    </SocketProvider>
  );
}
