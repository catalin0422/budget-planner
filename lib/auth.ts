import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * Orice utilizator Clerk isi poate face cont, iar datele sunt separate per
 * utilizator: fiecare interogare din lib/queries.ts filtreaza dupa `userId`.
 * Deci "logat" inseamna acces doar la propriile date.
 *
 * Documentatia Next spune explicit ca Proxy nu e o solutie completa de
 * autorizare; verificarea reala sta aici, langa date.
 */

/**
 * Intoarce userId-ul sesiunii Clerk sau raspunsul 401 daca nu e nimeni logat.
 * Utilizare:
 *   const user = await requireUser();
 *   if (user instanceof NextResponse) return user;
 *   user.userId ...
 */
export async function requireUser(): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  }
  return { userId };
}
