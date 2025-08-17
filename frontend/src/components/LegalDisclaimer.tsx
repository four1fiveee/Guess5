import React from 'react';

interface LegalDisclaimerProps {
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export const LegalDisclaimer: React.FC<LegalDisclaimerProps> = ({ isOpen, onAccept, onDecline }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-primary border border-accent rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        <h2 className="text-2xl font-bold text-accent mb-4 text-center">
          ⚖️ LEGAL DISCLAIMER & TERMS OF SERVICE
        </h2>
        
        <div className="text-sm text-white/90 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <div className="bg-secondary bg-opacity-20 rounded p-3">
            <h3 className="text-accent font-bold mb-2">IMPORTANT: PLEASE READ CAREFULLY</h3>
            <p className="text-white/80">
              By connecting your wallet and using Guess5, you acknowledge that you have read, understood, and agree to be bound by these terms and disclaimers.
            </p>
          </div>

          <section>
            <h4 className="text-accent font-bold mb-2">1. GAMING & LEGAL COMPLIANCE</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>Guess5 is a skill-based word game that may involve real money transactions.</li>
              <li>You must be at least 18 years old to use this service.</li>
              <li>You are responsible for ensuring compliance with all applicable laws in your jurisdiction.</li>
              <li>Gambling laws vary by state and country. You must verify that your participation is legal in your location.</li>
              <li>This service is not intended for use in jurisdictions where online gaming is prohibited.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">2. FINANCIAL RISKS & RESPONSIBILITIES</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>You acknowledge that you may lose money when participating in matches.</li>
              <li>All transactions are final and irreversible once confirmed on the blockchain.</li>
              <li>You are solely responsible for managing your cryptocurrency assets and wallet security.</li>
              <li>Cryptocurrency values are volatile and may fluctuate significantly.</li>
              <li>You understand that blockchain transactions may incur network fees beyond your control.</li>
              <li>You are responsible for all tax implications of your winnings and losses.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">3. WALLET SECURITY & LIABILITY</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>You are solely responsible for the security of your wallet and private keys.</li>
              <li>Guess5 has no access to your wallet or ability to recover lost funds.</li>
              <li>We are not liable for any losses due to wallet compromise, phishing, or user error.</li>
              <li>Never share your private keys or seed phrases with anyone.</li>
              <li>Use only official wallet applications and verify all transaction details.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">4. SERVICE DISCLAIMERS</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>Guess5 is provided "as is" without warranties of any kind.</li>
              <li>We do not guarantee uninterrupted service or error-free operation.</li>
              <li>Technical issues, network problems, or blockchain congestion may affect gameplay.</li>
              <li>We reserve the right to modify, suspend, or discontinue the service at any time.</li>
              <li>Match outcomes are determined by game logic and are final.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">5. LIMITATION OF LIABILITY</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>Guess5 and its operators shall not be liable for any direct, indirect, incidental, or consequential damages.</li>
              <li>Our total liability shall not exceed the amount you paid in entry fees in the 30 days preceding any claim.</li>
              <li>We are not responsible for losses due to technical failures, network issues, or third-party services.</li>
              <li>You waive any right to class action lawsuits or similar proceedings.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">6. INTELLECTUAL PROPERTY & CONDUCT</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>Guess5's software, design, and content are protected by intellectual property laws.</li>
              <li>You agree not to use automated tools, bots, or cheats to gain unfair advantages.</li>
              <li>You will not attempt to manipulate the game or exploit technical vulnerabilities.</li>
              <li>Violation of these terms may result in account suspension and forfeiture of funds.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">7. PRIVACY & DATA</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>Blockchain transactions are public and permanent.</li>
              <li>We may collect and store game data for service improvement and compliance.</li>
              <li>Your wallet address and transaction history may be publicly visible.</li>
              <li>We do not collect or store your private keys or personal information beyond what's necessary for the service.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">8. GOVERNING LAW & DISPUTES</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>These terms are governed by the laws of the United States.</li>
              <li>Any disputes shall be resolved through binding arbitration in the United States.</li>
              <li>You waive your right to a jury trial and class action participation.</li>
              <li>If any provision is found unenforceable, the remaining terms remain in effect.</li>
            </ul>
          </section>

          <div className="bg-red-900 bg-opacity-20 border border-red-500 rounded p-3">
            <h4 className="text-red-400 font-bold mb-2">⚠️ ACKNOWLEDGMENT</h4>
            <p className="text-white/90">
              By clicking "I Accept", you confirm that you have read and understood all terms above, 
              are of legal age, and agree to be bound by these terms. If you do not agree, please click "Decline" 
              and do not use this service.
            </p>
          </div>
        </div>

        <div className="flex justify-center space-x-4 mt-6">
          <button
            onClick={onDecline}
            className="px-6 py-3 bg-gray-600 text-white rounded-lg font-bold hover:bg-gray-700 transition-colors"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="px-6 py-3 bg-accent text-primary rounded-lg font-bold hover:bg-yellow-400 transition-colors"
          >
            I Accept & Continue
          </button>
        </div>
      </div>
    </div>
  );
};
