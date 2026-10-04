import { NextResponse } from "next/server";
import { loadMessages } from "@/i18n/messages";
import { LOCALES, type Locale } from "@/i18n/locale";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return new NextResponse(null, { status: 404 });
  return NextResponse.json(await loadMessages(locale as Locale), {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
