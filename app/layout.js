import "./globals.css";

export const metadata = {
  title: "Jay Invest",
  description: "個人資產、股票、黃金與大盤加碼追蹤"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
