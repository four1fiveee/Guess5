import React from 'react';

interface WalletInfo {
  name: string;
  icon: string;
  downloadUrl: string;
  description: string;
  mobile?: boolean;
}

const WALLETS: WalletInfo[] = [
  {
    name: 'Phantom',
    icon: '👻',
    downloadUrl: 'https://phantom.app/',
    description: 'Most popular Solana wallet with browser extension and mobile app',
    mobile: true,
  },
  {
    name: 'Solflare',
    icon: '🔥',
    downloadUrl: 'https://solflare.com/',
    description: 'Secure multi-chain wallet with advanced features',
    mobile: true,
  },
  {
    name: 'Backpack',
    icon: '🎒',
    downloadUrl: 'https://www.backpack.app/',
    description: 'Modern wallet with built-in NFT and token management',
    mobile: true,
  },
  {
    name: 'Glow',
    icon: '✨',
    downloadUrl: 'https://glow.app/',
    description: 'Lightweight and fast Solana wallet',
    mobile: true,
  },
  {
    name: 'Torus',
    icon: '🔐',
    downloadUrl: 'https://tor.us/',
    description: 'Social login wallet - connect with Google, Twitter, or email',
    mobile: false,
  },
];

export const WalletSetupGuide: React.FC = () => {
  return (
    <div className="bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-accent/10 rounded-2xl p-6 sm:p-8 border border-white/10 backdrop-blur-sm">
      <div className="text-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
          Need a Solana Wallet?
        </h2>
        <p className="text-white/70 text-sm sm:text-base">
          Choose from these popular wallet options to get started
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {WALLETS.map((wallet) => (
          <a
            key={wallet.name}
            href={wallet.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/50 rounded-xl p-4 transition-all duration-200 hover:scale-105 hover:shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="text-3xl flex-shrink-0">{wallet.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-white font-bold text-base group-hover:text-accent transition-colors">
                    {wallet.name}
                  </h3>
                  {wallet.mobile && (
                    <span className="text-[10px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded border border-green-500/30">
                      Mobile
                    </span>
                  )}
                </div>
                <p className="text-white/60 text-xs leading-relaxed mb-2">
                  {wallet.description}
                </p>
                <div className="flex items-center gap-1 text-accent text-xs font-semibold group-hover:gap-2 transition-all">
                  <span>Get Started</span>
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="text-blue-300 text-xl flex-shrink-0">💡</div>
          <div className="flex-1">
            <h4 className="text-blue-200 font-semibold text-sm mb-1">
              First time using a crypto wallet?
            </h4>
            <p className="text-white/70 text-xs leading-relaxed">
              After installing a wallet extension, you'll need to create a new wallet or import an existing one. 
              Make sure to{' '}
              <strong className="text-white">save your recovery phrase</strong> in a safe place - 
              you'll need it to restore your wallet if you lose access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

