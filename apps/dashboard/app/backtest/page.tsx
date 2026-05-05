import { SocketProvider } from "@/components/SocketProvider";
import { Header } from "@/components/Header";
import { BacktestView } from "@/components/BacktestView";

export default function BacktestPage() {
  return (
    <SocketProvider>
      <Header />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
        <BacktestView />
      </main>
    </SocketProvider>
  );
}
