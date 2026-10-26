import {
  accountResponse,
  signedInAccount,
  accountFailure,
} from "@/lib/account-access";
export async function GET() {
  try {
    return await accountResponse(await signedInAccount(), { signedIn: true });
  } catch (e) {
    return accountFailure(e);
  }
}
