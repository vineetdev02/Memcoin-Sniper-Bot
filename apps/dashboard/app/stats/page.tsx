import { SocketProvider } from "@/components/SocketProvider";
import { Header } from "@/components/Header";
import { StatsView } from "@/components/StatsView";

export default function StatsPage() {
  return (
    <SocketProvider>
      <Header />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <StatsView />
      </main>
    </SocketProvider>
  );
}
