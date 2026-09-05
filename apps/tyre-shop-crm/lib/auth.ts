import { cookies } from "next/headers";
import { COOKIE_NAME, gateToken, tokensMatch } from "./auth-core";

export {
  COOKIE_NAME,
  cookieOptions,
  cronAuthorized,
  gateToken,
  passwordOk,
  tokensMatch,
} from "./auth-core";

export async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return tokensMatch(jar.get(COOKIE_NAME)?.value, gateToken());
}
