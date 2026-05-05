import { SocketProvider } from "@/components/SocketProvider";
import { Header } from "@/components/Header";
import { BankrollBar } from "@/components/BankrollBar";
import { AnalyticsView } from "@/components/AnalyticsView";

export default function AnalyticsPage() {
  return (
    <SocketProvider>
      <Header />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
        <BankrollBar />
        <AnalyticsView />
      </main>
    </SocketProvider>
  );
}
