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
              By connecting your wallet and using Guess5, you acknowledge that you have read, understood, and agree to be bound by these terms and disclaimers. IF YOU DO NOT AGREE, DO NOT USE THIS SERVICE.
            </p>
          </div>

          <section>
            <h4 className="text-accent font-bold mb-2">1. NON-CUSTODIAL SERVICE & FUND CONTROL</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>YOU RETAIN FULL CONTROL:</strong> Guess5 is a fully non-custodial platform. All match funds are held in a 2-of-3 multisig vault (Squads Protocol) where YOU, YOUR OPPONENT, and the SYSTEM are co-signers.</li>
              <li><strong>NO CUSTODY:</strong> Guess5 NEVER has unilateral custody or control of your funds. We cannot access, freeze, seize, or move your funds without your cryptographic signature.</li>
              <li><strong>YOU CONTROL PAYOUTS:</strong> When you win or a tie occurs, YOU must sign the payout transaction. The system cannot pay you without your active approval and signature.</li>
              <li><strong>BLOCKCHAIN IMMUTABILITY:</strong> All transactions are executed via Solana blockchain smart contracts and are irreversible once confirmed.</li>
              <li><strong>SQUADS PROTOCOL:</strong> By using this service, you acknowledge reliance on third-party smart contract infrastructure (Squads Protocol) which Guess5 does not control or guarantee.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">2. LEGAL COMPLIANCE & AGE RESTRICTIONS</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>AGE REQUIREMENT:</strong> You must be at least 18 years old (or the age of majority in your jurisdiction, whichever is higher) to use this service.</li>
              <li><strong>YOUR RESPONSIBILITY:</strong> You are solely responsible for ensuring compliance with all applicable gaming, gambling, and financial laws in your jurisdiction.</li>
              <li><strong>SKILL-BASED GAME:</strong> Guess5 is marketed as a skill-based word game. However, legal interpretations vary by jurisdiction.</li>
              <li><strong>PROHIBITED JURISDICTIONS:</strong> This service is not intended for use in jurisdictions where online gaming for money is prohibited. Use of VPNs or location-masking to evade restrictions is strictly prohibited.</li>
              <li><strong>NO LEGAL ADVICE:</strong> Guess5 does not provide legal advice. Consult your own legal counsel regarding the legality of participation.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">3. FINANCIAL RISKS & CRYPTOCURRENCY VOLATILITY</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>RISK OF LOSS:</strong> You acknowledge and accept that you may lose 100% of the funds you commit to any match.</li>
              <li><strong>IRREVERSIBLE TRANSACTIONS:</strong> All blockchain transactions are final and irreversible. There are no refunds, chargebacks, or reversals.</li>
              <li><strong>PRICE VOLATILITY:</strong> Cryptocurrency values (SOL) fluctuate significantly. Your winnings or losses may change in fiat value before you can convert them.</li>
              <li><strong>NETWORK FEES:</strong> You are responsible for all Solana network transaction fees (gas), which may vary and are beyond Guess5's control.</li>
              <li><strong>TAX LIABILITY:</strong> You are solely responsible for reporting and paying all applicable taxes on winnings, losses, and transactions.</li>
              <li><strong>NO FINANCIAL ADVICE:</strong> Nothing in this service constitutes financial, investment, or tax advice.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">4. WALLET SECURITY & USER RESPONSIBILITIES</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>YOUR KEYS, YOUR RESPONSIBILITY:</strong> You are solely responsible for securing your wallet, private keys, seed phrases, and authentication credentials.</li>
              <li><strong>NO RECOVERY:</strong> Guess5 CANNOT recover lost, stolen, or forgotten private keys, seed phrases, or wallet access. Lost access means permanent loss of funds.</li>
              <li><strong>VERIFY TRANSACTIONS:</strong> Always verify transaction details, recipient addresses, and amounts before signing.</li>
              <li><strong>PHISHING PROTECTION:</strong> Guess5 will NEVER ask for your private keys or seed phrases. Beware of phishing attempts.</li>
              <li><strong>DEVICE SECURITY:</strong> Use secure devices and trusted wallet software. Compromised devices may result in theft of funds.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">5. SERVICE DISCLAIMERS & "AS IS" PROVISION</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>AS IS, WHERE IS:</strong> Guess5 is provided strictly "AS IS" and "AS AVAILABLE" without warranties of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement.</li>
              <li><strong>NO GUARANTEE:</strong> We do not guarantee error-free, uninterrupted, secure, or timely service.</li>
              <li><strong>TECHNICAL FAILURES:</strong> Service may be affected by bugs, network outages, blockchain congestion, smart contract failures, or third-party infrastructure issues.</li>
              <li><strong>MATCH OUTCOMES:</strong> Game results are determined by automated logic and are FINAL. We do not manually intervene or reverse outcomes.</li>
              <li><strong>RIGHT TO MODIFY:</strong> We reserve the right to modify, suspend, or discontinue the service (or any part thereof) at any time without notice or liability.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">6. LIMITATION OF LIABILITY & DAMAGES WAIVER</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>MAXIMUM EXCLUSION:</strong> TO THE MAXIMUM EXTENT PERMITTED BY LAW, GUESS5 AND ITS OPERATORS, AFFILIATES, PARTNERS, AND SERVICE PROVIDERS SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES.</li>
              <li><strong>LIABILITY CAP:</strong> Our total aggregate liability for all claims shall NOT exceed $100 USD or the equivalent in SOL at the time of claim, whichever is less.</li>
              <li><strong>NO LIABILITY FOR:</strong> Lost profits, lost data, lost funds, business interruption, wallet compromise, smart contract failures, blockchain errors, network congestion, third-party service failures, or any losses arising from your use or inability to use the service.</li>
              <li><strong>THIRD-PARTY RISKS:</strong> We are not responsible for failures, hacks, or vulnerabilities in Squads Protocol, Solana blockchain, wallet providers, or any third-party infrastructure.</li>
              <li><strong>USER ERROR:</strong> We are not liable for losses due to user error, misunderstanding of the service, incorrect transactions, or failure to read these terms.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">7. INDEMNIFICATION & HOLD HARMLESS</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>YOU INDEMNIFY US:</strong> You agree to indemnify, defend, and hold harmless Guess5, its operators, officers, employees, contractors, affiliates, and agents from any claims, damages, losses, liabilities, costs, or expenses (including attorney fees) arising from:</li>
              <li>(a) Your use or misuse of the service</li>
              <li>(b) Your violation of these terms</li>
              <li>(c) Your violation of any applicable laws or regulations</li>
              <li>(d) Your infringement of third-party rights</li>
              <li>(e) Any disputes between you and other users</li>
              <li>(f) Any tax liabilities arising from your participation</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">8. PROHIBITED CONDUCT & ANTI-CHEATING</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>NO BOTS OR AUTOMATION:</strong> Use of automated tools, bots, scripts, or AI to play games is strictly prohibited.</li>
              <li><strong>NO EXPLOITATION:</strong> Attempting to exploit bugs, vulnerabilities, or game mechanics is prohibited.</li>
              <li><strong>NO COLLUSION:</strong> Coordinating with opponents to manipulate outcomes is prohibited.</li>
              <li><strong>NO SYBIL ATTACKS:</strong> Creating multiple accounts or using the same account on multiple devices to gain unfair advantage is prohibited.</li>
              <li><strong>CONSEQUENCES:</strong> Violation may result in immediate account termination, forfeiture of all funds (including winnings), and legal action.</li>
              <li><strong>DETECTION:</strong> We employ bot protection, rate limiting, and monitoring. Suspected cheating will be investigated.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">9. PRIVACY, DATA COLLECTION & BLOCKCHAIN TRANSPARENCY</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>PUBLIC BLOCKCHAIN:</strong> All transactions are recorded on the Solana blockchain and are publicly visible and permanent.</li>
              <li><strong>NO ANONYMITY:</strong> Your wallet address and transaction history are public and can be linked to your identity.</li>
              <li><strong>DATA COLLECTION:</strong> We may collect match data, IP addresses, browser information, and user behavior for service operation, fraud prevention, and compliance.</li>
              <li><strong>NO PRIVATE KEYS:</strong> We never collect, store, or have access to your private keys or seed phrases.</li>
              <li><strong>THIRD-PARTY SERVICES:</strong> We use third-party services (Vercel, Render, Redis, PostgreSQL) which have their own privacy policies.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">10. DISPUTE RESOLUTION, ARBITRATION & CLASS ACTION WAIVER</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>BINDING ARBITRATION:</strong> Any dispute, claim, or controversy arising from or relating to this service shall be resolved by BINDING ARBITRATION administered by the American Arbitration Association (AAA) in accordance with its Commercial Arbitration Rules.</li>
              <li><strong>INDIVIDUAL BASIS ONLY:</strong> Arbitration shall be conducted on an individual basis only. YOU WAIVE YOUR RIGHT TO PARTICIPATE IN A CLASS ACTION, CLASS ARBITRATION, OR ANY REPRESENTATIVE PROCEEDING.</li>
              <li><strong>JURY TRIAL WAIVER:</strong> YOU WAIVE YOUR RIGHT TO A JURY TRIAL.</li>
              <li><strong>GOVERNING LAW:</strong> These terms are governed by the laws of the State of Delaware, United States, without regard to conflict of law principles.</li>
              <li><strong>VENUE:</strong> Arbitration shall take place in Wilmington, Delaware or remotely at the arbitrator's discretion.</li>
              <li><strong>COSTS:</strong> Each party shall bear their own arbitration costs and attorney fees unless awarded by the arbitrator.</li>
              <li><strong>SEVERABILITY:</strong> If any provision of these terms is found unenforceable, the remaining provisions shall remain in full force and effect.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">11. INTELLECTUAL PROPERTY & LICENSE</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>OUR PROPERTY:</strong> All content, software, logos, trademarks, and intellectual property related to Guess5 are owned by Guess5 or its licensors.</li>
              <li><strong>LIMITED LICENSE:</strong> You are granted a limited, non-exclusive, non-transferable, revocable license to use the service for personal, non-commercial purposes only.</li>
              <li><strong>NO REVERSE ENGINEERING:</strong> You may not copy, modify, reverse engineer, decompile, or create derivative works of the service.</li>
              <li><strong>FEEDBACK:</strong> Any feedback or suggestions you provide may be used by Guess5 without compensation or attribution.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">12. FORCE MAJEURE & UNCONTROLLABLE EVENTS</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li>Guess5 shall not be liable for failure or delay in performance due to events beyond our reasonable control, including but not limited to: acts of God, natural disasters, war, terrorism, pandemics, government actions, blockchain network failures, internet outages, cyberattacks, smart contract vulnerabilities, or failures of third-party infrastructure.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">13. ENTIRE AGREEMENT & MODIFICATIONS</h4>
            <ul className="list-disc list-inside space-y-1 text-white/80">
              <li><strong>ENTIRE AGREEMENT:</strong> These terms constitute the entire agreement between you and Guess5 and supersede all prior agreements or understandings.</li>
              <li><strong>MODIFICATIONS:</strong> We may modify these terms at any time. Continued use after modifications constitutes acceptance of the new terms.</li>
              <li><strong>NO WAIVER:</strong> Our failure to enforce any right or provision does not constitute a waiver of that right or provision.</li>
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
