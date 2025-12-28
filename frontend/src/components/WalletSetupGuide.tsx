import React from 'react';

interface WalletInfo {
  name: string;
  downloadUrl: string;
  description: string;
  mobile?: boolean;
}

const WALLETS: WalletInfo[] = [
  {
    name: 'Phantom',
    downloadUrl: 'https://phantom.app/',
    description: 'Most popular Solana wallet with browser extension and mobile app',
    mobile: true,
  },
  {
    name: 'Solflare',
    downloadUrl: 'https://solflare.com/',
    description: 'Secure multi-chain wallet with advanced features',
    mobile: true,
  },
  {
    name: 'Coinbase Wallet',
    downloadUrl: 'https://www.coinbase.com/wallet',
    description: 'Connects to your Coinbase account for easy crypto management',
    mobile: true,
  },
  {
    name: 'Ledger',
    downloadUrl: 'https://www.ledger.com/ledger-live/download',
    description: 'Hardware wallet for enhanced security',
    mobile: false,
  },
  {
    name: 'Trust Wallet',
    downloadUrl: 'https://trustwallet.com/download',
    description: 'Secure multi-chain crypto wallet',
    mobile: true,
  },
];

export const WalletSetupGuide: React.FC = () => {
  return (
    <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-accent mb-3">
          Need a Solana Wallet?
        </h2>
        <p className="text-white/70 text-sm">
          Choose from these popular wallet options to get started. Click any wallet to visit their official download page.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {WALLETS.map((wallet) => (
          <a
            key={wallet.name}
            href={wallet.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/50 rounded-lg p-4 transition-all duration-200 hover:shadow-lg"
          >
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-bold text-base group-hover:text-accent transition-colors">
                  {wallet.name}
                </h3>
                {wallet.mobile && (
                  <span className="text-[10px] bg-green-500/20 text-green-300 px-2 py-0.5 rounded border border-green-500/30">
                    Mobile
                  </span>
                )}
              </div>
              <p className="text-white/60 text-xs leading-relaxed mb-3 flex-grow">
                {wallet.description}
              </p>
              <div className="flex items-center gap-1 text-accent text-xs font-semibold group-hover:gap-2 transition-all">
                <span>Visit Site</span>
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
          </a>
        ))}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <svg
              className="w-5 h-5 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-accent font-semibold text-sm mb-1">
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

