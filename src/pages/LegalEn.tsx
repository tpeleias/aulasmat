import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CronysWordmark } from "@/components/brand";

// As páginas legais em inglês, para empresas (e clientes delas) com o app em
// inglês. Mesmo conteúdo das versões em português - mudou uma, muda a outra.
// Tradução do rascunho, também não revisada por advogado.
const UPDATED_AT = "September 24, 2026";

function Shell({ title, updated = true, children }: { title: string; updated?: boolean; children: ReactNode }) {
  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
          <CronysWordmark tamanho="1.125rem" className="text-foreground" />
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
        {updated && <p className="mt-1 text-sm text-muted-foreground">Updated on {UPDATED_AT}.</p>}
        <div className="mt-8 space-y-6 text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-base">{title}</h2>
      {children}
    </section>
  );
}

export function TermsEn({ contact }: { contact: string | null }) {
  return (
    <Shell title="Terms of use">
      <Section title="1. What Cronys is">
        <p>
          Cronys is a tool for professionals and businesses that work by appointment (schools and
          tutors, clinics, therapists, salons, workshops and others) to organize their calendar,
          client records, billing, materials and tasks. Cronys is contracted by the professional or
          business ("business"). Clients and guardians use the app at the business's invitation.
        </p>
      </Section>
      <Section title="2. Account and access">
        <p>
          Each person is responsible for keeping their password secret and for what is done with
          their access. The business is responsible for the logins it creates for clients, guardians
          and team members, and for removing them when they are no longer needed.
        </p>
      </Section>
      <Section title="3. Plans, trial and cancellation">
        <ul className="list-disc space-y-1 pl-5">
          <li>The <strong>Cronys Essential</strong> plan is free and has limits on active clients and professionals.</li>
          <li>The paid plans (<strong>Cronys Start</strong>, <strong>Cronys Pro</strong> and <strong>Cronys Max</strong>) unlock the features described on the website and in the app.</li>
          <li>New businesses start with a Pro trial. When it ends without a subscription, the account
            moves to Essential: nothing is deleted. Clients stay accessible, but new clients can only
            be added below the plan limit, and the business chooses which professionals stay active.</li>
          <li>The subscription can be canceled at any time and stays active until the end of the
            period already paid, without prejudice to any withdrawal rights under applicable
            consumer law.</li>
        </ul>
      </Section>
      <Section title="4. Payments between the business and its clients">
        <p>
          Cronys helps the business record appointments and request payment, but it <strong>does not
          receive, intermediate or guarantee</strong> payments between the business and its clients.
          Payment links, payment details and amounts are set by the business, which is responsible
          for them.
        </p>
      </Section>
      <Section title="5. Personal data">
        <p>
          Client and guardian data belongs to the business, which decides how it is used (data
          controller). Cronys stores and processes that data on the business's behalf, only to make
          the app work (data processor). Details are in the{" "}
          <Link to="/privacidade" className="text-primary underline">privacy policy</Link>.
        </p>
      </Section>
      <Section title="6. Acceptable use">
        <p>
          You may not use Cronys for illegal purposes, enter third-party data without
          authorization, try to access another business's data, overload the service or
          circumvent plan limits.
        </p>
      </Section>
      <Section title="7. Availability">
        <p>
          Cronys is provided as is. We aim to keep it always online and the data protected, but
          interruptions may happen for maintenance or due to third-party failures (hosting, app
          stores, internet). We recommend that businesses export their reports periodically.
        </p>
      </Section>
      <Section title="8. Account deletion">
        <p>
          Anyone can delete their own access in the app, under <strong>My account → Delete my
          account</strong>, or by following the instructions at{" "}
          <Link to="/excluir-conta" className="text-primary underline">/excluir-conta</Link>. The
          appointment and payment history stays with the business, which may need it for its
          financial records; requests to delete that data go to the business.
        </p>
      </Section>
      <Section title="9. Changes to these terms">
        <p>These terms may change. Relevant changes will be announced in the app before they take effect.</p>
      </Section>
      <Section title="10. Contact">
        <p>{contact ? <>Questions about these terms: {contact}.</> : "For questions about these terms, contact the business you work with."}</p>
      </Section>
    </Shell>
  );
}

export function PrivacyEn({ contact }: { contact: string | null }) {
  return (
    <Shell title="Privacy policy">
      <Section title="What this app is">
        <p>
          Cronys organizes the appointments of a business or professional (lessons, consultations,
          sessions, services): calendar, client records, billing and materials. It is used by the
          business, its team and the clients it serves. There are no ads and no data is sold.
        </p>
      </Section>
      <Section title="Data the app stores">
        <ul className="list-disc space-y-1 pl-5">
          <li>Name of the person served, name of the guardian and the address where the appointment takes place.</li>
          <li>Email or username and password used to sign in.</li>
          <li>Date, time, duration, topic and status of each appointment, and the notes the professional records.</li>
          <li>Amounts charged, payments recorded and credits.</li>
          <li>Materials and tasks sent by the professional, and files uploaded by the client.</li>
        </ul>
        <p>The app does not access contacts, camera, location or microphone, and does not collect usage data for advertising.</p>
      </Section>
      <Section title="What it is used for">
        <p>
          Only to arrange and record appointments, track payments and share materials. Each client
          sees only their own data. A minor's own login shows appointments, materials and tasks,
          and never amounts.
        </p>
      </Section>
      <Section title="Who the data is shared with">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Supabase</strong>, where the database and files are hosted.</li>
          <li><strong>Anthropic</strong>, when the business uses the in-app assistant: the conversation
            text and the data needed to answer are sent for processing. Only the business admin can
            use the assistant.</li>
          <li>The <strong>payment provider chosen by the business</strong>, if the client pays through
            the business's payment link. Payment happens on the provider's site, under its own
            privacy policy.</li>
        </ul>
        <p>Nothing else is shared.</p>
      </Section>
      <Section title="Google Calendar (optional)">
        <p>
          A professional can connect their own Google account. Cronys then reads only the{" "}
          <strong>busy times</strong> of their main calendar (no titles, descriptions or guests) to block
          those times in Cronys, and creates a separate calendar called "Cronys" in their Google
          account, where it adds, changes and removes the professional's appointments. Cronys does
          not read or change any other calendar or event.
        </p>
        <p>
          Cronys's use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className="text-primary underline">
            Google API Services User Data Policy</a>, including the Limited Use requirements. This data is
          not used for advertising, is not sold and is not used to train AI models. Disconnecting in
          the app deletes the "Cronys" calendar, removes the imported busy times and revokes access;
          access can also be removed at any time at myaccount.google.com/permissions.
        </p>
      </Section>
      <Section title="Children's data">
        <p>
          A minor's record is created by the business from what the guardian provides, and the
          minor's own login is created with the guardian's permission. The guardian can ask at any
          time for the child's login and data to be removed.
        </p>
      </Section>
      <Section title="How long data is kept">
        <p>
          For as long as the relationship with the business lasts, and afterwards for the time needed
          for financial records. You can delete your access at any time in the app, under My account →
          Delete my account (see <Link to="/excluir-conta" className="text-primary underline">how to delete</Link>),
          and ask the business you work with to delete the remaining data.
        </p>
      </Section>
      <Section title="Your rights">
        <p>
          Under applicable data protection laws (such as the LGPD and GDPR), you can request access
          to, correction or deletion of your data and your child's data, and find out who it was
          shared with.{contact ? <> Just write to {contact}.</> : " Just ask the business you work with."}
        </p>
      </Section>
      <Section title="Contact">
        <p>{contact ? <>Questions about this policy: {contact}.</> : "For questions about this policy, contact the business you work with."}</p>
      </Section>
    </Shell>
  );
}

export function DeleteAccountEn({ contact }: { contact: string | null }) {
  return (
    <Shell title="How to delete your Cronys account" updated={false}>
      <Section title="In the app or on the website">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Sign in with your login.</li>
          <li>Open the menu and tap <strong>My account</strong>.</li>
          <li>Tap <strong>Delete my account</strong> and confirm by typing DELETE.</li>
        </ol>
        <p>Your access is deleted immediately.</p>
      </Section>
      <Section title="What is deleted and what stays">
        <p>
          Your login (email or username and password) and its link to your record are deleted. The
          appointment and payment history belongs to the business you work with and stays with it
          for as long as needed for financial records. To ask for that data to be deleted too,
          contact the business.
        </p>
      </Section>
      <Section title="No access to the app?">
        <p>
          {contact
            ? <>Write to {contact} with the account's email or username, asking for deletion.</>
            : "Ask the business you work with for deletion, giving the account's email or username."}
        </p>
      </Section>
    </Shell>
  );
}
