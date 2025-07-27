import Image from 'next/image';
import Link from 'next/link';
import logo from '../../public/logo.png';

const LogoHeader = () => (
  <div className="flex flex-col items-center my-6">
    <Link href="/">
      <Image src={logo} alt="Guess5 Logo" width={80} height={80} className="cursor-pointer drop-shadow-lg" />
    </Link>
    <h1 className="text-2xl font-extrabold text-white mt-2 tracking-wide">Guess5</h1>
  </div>
);

export default LogoHeader; 