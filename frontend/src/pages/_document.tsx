import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script 
          src="https://www.google.com/recaptcha/enterprise.js?render=6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI"
          async
          defer
        />
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