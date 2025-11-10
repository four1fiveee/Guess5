import Image from 'next/image';
import Link from 'next/link';
import logo from '../../public/logo.png';

const LogoHeader = () => (
  <div className="flex flex-col items-center my-6">
    <Link href="/" className="cursor-pointer">
      <div className="logo-shell transition-transform hover:scale-105">
        <Image src={logo} alt="Guess5 Logo" width={80} height={80} priority />
      </div>
    </Link>
  </div>
);

export default LogoHeader; 