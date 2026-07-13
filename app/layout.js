import "./globals.css";

export const metadata = {
  title: "Jay Invest",
  description: "雲端同步資產管理"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
