import LeagueChatProvider from "@/app/components/chat/LeagueChatProvider";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: leagueId } = await params;
  return (
    <>
      {children}
      <LeagueChatProvider leagueId={leagueId} />
    </>
  );
}
