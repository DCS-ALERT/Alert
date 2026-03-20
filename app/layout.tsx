import "./globals.css";

export const metadata = {
  title: "DCS Alert",
  description: "DCS Alert dashboard"
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
