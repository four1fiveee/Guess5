import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/logo.png" />
        <meta name="theme-color" content="#1e293b" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
} 