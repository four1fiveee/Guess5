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
          Guess5.io – Terms of Use and Disclaimers
        </h2>
        <p className="text-xs text-white/60 text-center mb-4">
          <strong>Last Updated:</strong> October 28, 2025
        </p>
        
        <div className="text-sm text-white/90 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <div className="bg-secondary bg-opacity-20 rounded p-3">
            <p className="text-white/80">
              By connecting your wallet, clicking "I Accept," or otherwise using Guess5.io ("Guess5," "we," "our," or "us"), you acknowledge that you have read, understood, and agree to be bound by these Terms of Use and Disclaimers (the "Terms").
            </p>
            <p className="text-white/80 mt-2">
              <strong>Acceptance of these Terms requires affirmative consent through a clear "I Accept" action prior to gameplay or wallet connection.</strong>
            </p>
            <p className="text-white/80 mt-2">
              If you do not agree, do not connect your wallet, access, or use Guess5.
            </p>
          </div>

          <section>
            <h4 className="text-accent font-bold mb-2">1. Non-Custodial Service & User Control</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>1.1 Non-Custodial Platform.</strong> Guess5 is a fully non-custodial platform built on the Solana blockchain. All match funds are held in a 2-of-3 multisignature vault (via Squads Protocol), in which you, your opponent, and the system are co-signers.</li>
              <li><strong>1.2 No Custody or Access.</strong> Guess5 never has unilateral control or custody of user funds and cannot transfer, freeze, seize, or move funds without your cryptographic signature.</li>
              <li><strong>1.3 User-Controlled Payouts.</strong> Match payouts require your active signature. The system cannot process any payout without your participation.</li>
              <li><strong>1.4 Third-Party Smart Contract Infrastructure.</strong> Guess5 relies on smart contracts and infrastructure provided by third parties, including Squads Protocol. Guess5 does not control or guarantee the operation or security of those systems.</li>
              <li><strong>1.5 Blockchain Immutability.</strong> Transactions on Solana are public, immutable, and irreversible once confirmed.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">2. Legal Compliance & Eligibility</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>2.1 Age Restriction.</strong> You must be at least 18 years old or the age of majority in your jurisdiction (whichever is greater).</li>
              <li><strong>2.2 Legal Responsibility.</strong> You are solely responsible for ensuring that your participation complies with all applicable gaming, gambling, financial, and digital asset laws in your jurisdiction.</li>
              <li><strong>2.3 Skill-Based Game.</strong> Guess5 is marketed and operated as a skill-based game of knowledge and logic, not chance. Legal interpretations of "skill" may vary by jurisdiction.</li>
              <li><strong>2.4 Prohibited Jurisdictions.</strong> Guess5 is not available in jurisdictions where skill-based, staked, or online gaming for money is prohibited. Use of VPNs, proxies, or location-masking to evade restrictions is strictly prohibited.</li>
              <li><strong>2.5 Sanctions & OFAC Compliance.</strong> Guess5 does not permit access or use by individuals or entities:</li>
              <li className="pl-4">• Located in, or ordinarily resident of, any jurisdiction subject to U.S. sanctions (including Cuba, Iran, North Korea, Syria, or the Crimea, Donetsk, or Luhansk regions of Ukraine);</li>
              <li className="pl-4">• Listed on any OFAC, EU, UN, or similar sanctions list.</li>
              <li>By using Guess5, you represent that you are not subject to such restrictions.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">3. Financial Risks & Digital Asset Disclaimers</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>3.1 Risk of Loss.</strong> You acknowledge that participation in any match involves risk of losing 100% of your staked funds.</li>
              <li><strong>3.2 Volatility.</strong> The value of SOL and other digital assets is highly volatile. Guess5 has no responsibility for market fluctuations.</li>
              <li><strong>3.3 Irreversible Transactions.</strong> ALL TRANSACTIONS ARE FINAL — NO REFUNDS OR REVERSALS.</li>
              <li><strong>3.4 Network Fees.</strong> You are responsible for Solana network fees (gas) associated with your transactions.</li>
              <li><strong>3.5 Taxes.</strong> You are solely responsible for determining and paying all taxes that apply to your activities, winnings, or losses.</li>
              <li><strong>3.6 No Financial Advice.</strong> Guess5 provides no financial, investment, or tax advice.</li>
              <li><strong>3.7 Regulatory Classification.</strong> Guess5 is not a bank, money transmitter, broker-dealer, or financial institution. All transactions occur directly between users via decentralized smart contracts.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">4. Wallet Security & User Responsibilities</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>4.1 Your Keys, Your Responsibility.</strong> You are solely responsible for safeguarding your private keys, seed phrases, and wallet credentials.</li>
              <li><strong>4.2 No Key Recovery.</strong> Guess5 cannot recover lost, stolen, or forgotten wallet access.</li>
              <li><strong>4.3 Verify Transactions.</strong> Always confirm wallet addresses and transaction details before signing.</li>
              <li><strong>4.4 Phishing & Device Security.</strong> Guess5 will never request your private keys or seed phrases. Use secure, trusted devices and wallet software only.</li>
              <li><strong>4.5 User Negligence.</strong> Losses arising from compromised wallets, phishing, malware, or device breaches are solely your responsibility.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">5. Service Disclaimers</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>5.1 "As Is" Service.</strong> Guess5 is provided "AS IS" and "AS AVAILABLE", without warranties of any kind—express, implied, or statutory—including but not limited to merchantability, fitness for a particular purpose, and non-infringement.</li>
              <li><strong>5.2 No Guarantee of Uptime.</strong> Guess5 does not warrant uninterrupted, error-free, or secure operation.</li>
              <li><strong>5.3 Third-Party & Blockchain Dependencies.</strong> We are not liable for disruptions, failures, or bugs caused by Solana, Squads Protocol, wallet software, or any third-party provider.</li>
              <li><strong>5.4 Match Results.</strong> All outcomes are final, automated, and non-reviewable. No manual intervention or reversal will occur.</li>
              <li><strong>5.5 Modification or Suspension.</strong> We may modify, suspend, or discontinue Guess5 at any time without prior notice or liability.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">6. Limitation of Liability</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>6.1 Maximum Liability Cap.</strong> To the maximum extent permitted by law, the total aggregate liability of Guess5 and its affiliates shall not exceed the greater of USD $100 or the total amount of SOL you staked in the match giving rise to the claim (capped at USD $250).</li>
              <li><strong>6.2 Exclusion of Damages.</strong> Guess5 shall not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, including loss of data, profits, or funds.</li>
              <li><strong>6.3 No Responsibility for Third-Party Failures.</strong> Guess5 disclaims all liability for errors or losses arising from:</li>
              <li className="pl-4">• Squads Protocol or Solana network failures;</li>
              <li className="pl-4">• Wallet vulnerabilities;</li>
              <li className="pl-4">• Smart contract exploits;</li>
              <li className="pl-4">• Network congestion or downtime;</li>
              <li className="pl-4">• User error or misunderstanding.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">7. Indemnification</h4>
            <p className="text-white/80 pl-4">
              You agree to indemnify, defend, and hold harmless Guess5, its affiliates, officers, contractors, and agents from and against any claims, damages, liabilities, or expenses (including attorneys' fees) arising out of or related to:
            </p>
            <ul className="list-none space-y-1 text-white/80 pl-8">
              <li>(a) your use or misuse of Guess5;</li>
              <li>(b) violation of these Terms or any applicable laws;</li>
              <li>(c) disputes between you and other users;</li>
              <li>(d) tax obligations from your activities; or</li>
              <li>(e) infringement of third-party rights.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">8. Prohibited Conduct</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li>• Use of bots, scripts, automation, or AI to play or influence outcomes;</li>
              <li>• Exploitation of bugs, vulnerabilities, or match logic;</li>
              <li>• Collusion or coordinated manipulation with other players;</li>
              <li>• Creation of multiple or Sybil accounts for advantage.</li>
            </ul>
            <p className="text-white/80 pl-4 mt-2">
              Violations may result in immediate termination, forfeiture of staked funds, and referral to authorities.
            </p>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">9. Privacy, Cookies & Data Use</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>9.1 Blockchain Transparency.</strong> Transactions and wallet addresses are public and permanently recorded on the Solana blockchain.</li>
              <li><strong>9.2 Data Collection.</strong> We may collect limited technical data (IP, browser type, device, match performance, and behavioral analytics) to ensure platform integrity and compliance.</li>
              <li><strong>9.3 Cookies.</strong> Guess5 uses cookies and analytics tools for functionality, security, and usage analytics. Continued use constitutes consent to such use.</li>
              <li><strong>9.4 Third-Party Services.</strong> We rely on third-party infrastructure (e.g., Vercel, Render, Redis, PostgreSQL) subject to their own privacy policies.</li>
              <li><strong>9.5 No Private Key Access.</strong> Guess5 never collects or stores private keys or seed phrases.</li>
              <li><strong>9.6 Privacy Rights.</strong> Depending on your jurisdiction, you may have rights to access, correct, or delete personal data. Requests may be directed to privacy@guess5.io. Guess5 complies with applicable data-protection laws to the extent required.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">10. Dispute Resolution & Arbitration</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>10.1 Mutual Binding Arbitration.</strong> You and Guess5 mutually agree that any dispute or claim arising out of or relating to these Terms shall be resolved exclusively through binding arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules.</li>
              <li><strong>10.2 Location & Governing Law.</strong> Arbitration shall take place in Wilmington, Delaware, USA, or remotely at the arbitrator's discretion, under Delaware law, excluding conflict-of-law principles.</li>
              <li><strong>10.3 Individual Basis.</strong> All disputes must be brought individually. No class actions or representative proceedings are permitted.</li>
              <li><strong>10.4 Jury Waiver.</strong> You expressly waive any right to a jury trial.</li>
              <li><strong>10.5 Opt-Out.</strong> You may opt out of arbitration within 30 days of first acceptance by notifying us in writing at legal@guess5.io.</li>
              <li><strong>10.6 Costs.</strong> Each party bears its own arbitration costs and fees unless otherwise determined by the arbitrator.</li>
              <li><strong>10.7 Severability.</strong> If any provision is unenforceable, the remainder shall remain in effect.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">11. Intellectual Property</h4>
            <p className="text-white/80 pl-4">
              All software, content, logos, and materials on Guess5 are owned by Guess5 or its licensors. You are granted a limited, revocable, non-exclusive, non-transferable license to use Guess5 for personal, non-commercial purposes only. You may not copy, modify, reverse engineer, or redistribute the platform or its components.
            </p>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">12. Force Majeure</h4>
            <p className="text-white/80 pl-4">
              Guess5 shall not be liable for any failure or delay caused by events beyond reasonable control, including but not limited to acts of God, natural disasters, war, terrorism, pandemics, regulatory actions, blockchain network outages, failures of underlying blockchain consensus mechanisms, cyberattacks, or third-party infrastructure failures.
            </p>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">13. Modifications & Entire Agreement</h4>
            <p className="text-white/80 pl-4">
              We may update these Terms at any time by posting a revised version at Guess5.io. Continued use constitutes acceptance. These Terms represent the entire agreement between you and Guess5 and supersede any prior understandings.
            </p>
            <p className="text-white/80 pl-4 mt-2">
              No waiver of any provision is deemed a waiver of any other.
            </p>
          </section>

          <section>
            <h4 className="text-accent font-bold mb-2">14. Referral Program Terms</h4>
            <ul className="list-none space-y-1 text-white/80 pl-4">
              <li><strong>14.1 Independent Participants.</strong> The Guess5 referral program ("Referral Program") allows eligible users ("Referrers") to earn referral rewards based on a percentage of net profits generated by players they refer. Referrers participate as independent contractors, not employees, partners, agents, franchisees, or representatives of Guess5. Nothing in these Terms creates any employment, partnership, fiduciary, or agency relationship. Referrers have no authority to bind Guess5 in any manner.</li>
              <li><strong>14.2 Eligibility & Enrollment.</strong> Participation is limited to users in good standing with verified wallets. Guess5 may reject, suspend, or terminate any participant at its discretion for any reason, including suspected abuse or fraud.</li>
              <li><strong>14.3 Referral Rewards.</strong> Referral rewards are calculated as a percentage of net profit earned from matches played by referred users, as determined solely by Guess5. Guess5's calculation of "net profit" and eligibility is final and not subject to audit or appeal.</li>
              <li><strong>14.4 Payment Schedule.</strong> Referral rewards accrue and are payable once a minimum balance of USD $20 (or equivalent) is reached. Payments are made weekly on Sundays at 1:00 p.m. Eastern Time, subject to network availability and Guess5's operational discretion.</li>
              <li><strong>14.5 Non-Guarantee of Earnings.</strong> Participation in the Referral Program does not guarantee any earnings. Guess5 may modify, suspend, or discontinue the Referral Program or its payout formula at any time without prior notice.</li>
              <li><strong>14.6 Taxes.</strong> Referrers are solely responsible for reporting and paying all applicable taxes on referral rewards. Guess5 may issue tax forms or disclosures as required by law.</li>
              <li><strong>14.7 No Representations or Endorsements.</strong> Referrers may not make misleading statements or represent themselves as acting on behalf of Guess5. Any marketing must comply with applicable laws, including restrictions on gaming promotion, anti-spam, and advertising.</li>
              <li><strong>14.8 Fraud, Abuse & Forfeiture.</strong> Guess5 reserves the right to withhold or claw back referral rewards in cases of fraud, self-referrals, collusion, or manipulation.</li>
              <li><strong>14.9 Termination of Participation.</strong> Guess5 may terminate or limit participation in the Referral Program at any time without liability. Upon termination, any unpaid rewards below the minimum threshold are forfeited.</li>
            </ul>
          </section>

          <div className="bg-red-900 bg-opacity-20 border border-red-500 rounded p-3">
            <h4 className="text-red-400 font-bold mb-2">⚠️ Acceptance & Acknowledgment</h4>
            <p className="text-white/90 mb-2">
              By clicking "I Accept" or connecting your wallet, you confirm that:
            </p>
            <ul className="list-disc list-inside text-white/90 space-y-1">
              <li>You have read and understood these Terms, including the Referral Program Terms (if applicable);</li>
              <li>You are of legal age and authority to agree; and</li>
              <li>You accept and agree to be bound by all provisions above.</li>
            </ul>
            <p className="text-white/90 mt-2">
              If you do not agree, do not use Guess5.
            </p>
          </div>

          <div className="text-center text-xs text-white/50 mt-4 border-t border-accent/30 pt-3">
            <p>© 2025 Guess5.io. All rights reserved.</p>
            <p className="mt-1"><strong>Last Updated:</strong> October 28, 2025</p>
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
