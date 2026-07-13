import "@/app/globals.css";

export const metadata = {
  title: "SNOMED CT on MongoDB",
  description: "SNOMED CT navigation and bounded clinical-note grounding powered by MongoDB. Deterministic terminology search, hierarchy exploration, ECL scope, and auditable coding review.",
  icons: {
    icon: "/mongodb-mark.svg"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
