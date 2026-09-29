import { redirect } from "next/navigation";

// 旧URLを開いた人も、本人のアカウントでログインする。
export default function AdminLoginPage() {
  redirect("/login?next=admin");
}
