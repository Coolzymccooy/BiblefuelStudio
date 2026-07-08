import { useState } from 'react';
import { motion } from 'framer-motion';
import { z } from 'zod';
import { useEditorialMotion } from './motion';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Please enter a valid email').max(254),
  org: z.string().trim().min(1, 'Ministry, church, or channel is required').max(200),
  pitch: z.string().trim().min(1, 'A sentence is required').max(500, 'Please keep it to 500 characters'),
  hp_url: z.string().max(2000).default(''),
});

type FormState = z.infer<typeof schema>;

const initial: FormState = { name: '', email: '', org: '', pitch: '', hp_url: '' };

export function AccessForm() {
  const m = useEditorialMotion();
  const [values, setValues] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof FormState;
        if (!next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setServerError('Something went wrong. Please try again in a moment.');
      }
    } catch {
      setServerError('Something went wrong. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="access" className="bg-[#0d0906] px-5 py-14 text-center sm:px-8 sm:py-20 md:px-10">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.4 }}
        variants={m.fadeUp}
        className="mx-auto max-w-[520px]"
      >
        {submitted ? (
          <div>
            <h2 className="font-displaySerif text-[34px] leading-tight text-bf-cream sm:text-[44px]">Received.</h2>
            <p className="mt-3 font-bodyserif text-[14px] text-bf-sub sm:text-[15px]">
              We'll be in touch soon — usually within a few days.
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-displaySerif text-[34px] leading-tight text-bf-cream sm:text-[44px]">Request access.</h2>
            <p className="mt-3 mb-8 font-bodyserif text-[14px] text-bf-sub sm:mb-9 sm:text-[15px]">
              The studio is opening in waves to a small number of ministries and creators.
              Tell us a little about your work — we'll be in touch.
            </p>

            <form onSubmit={onSubmit} className="flex flex-col gap-3 text-left" noValidate>
              <Field label="Your name" name="name" value={values.name} onChange={update('name')} error={errors.name} />
              <Field label="Email" name="email" type="email" value={values.email} onChange={update('email')} error={errors.email} />
              <Field label="Ministry, church, or channel name" name="org" value={values.org} onChange={update('org')} error={errors.org} />
              <Field label="A sentence about what you're making" name="pitch" textarea value={values.pitch} onChange={update('pitch')} error={errors.pitch} />

              {/* Honeypot: invisible to humans, fillable by naive bots. */}
              <label className="bf-honeypot" aria-hidden="true">
                Website
                <input
                  type="text"
                  name="hp_url"
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.hp_url}
                  onChange={update('hp_url')}
                />
              </label>

              {serverError && (
                <div className="rounded-md border border-[rgba(224,138,138,0.3)] bg-[rgba(224,138,138,0.08)] p-3 text-[13px] text-bf-danger">
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary mt-2 h-[50px] rounded-[13px] text-[13px] disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit request →'}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </section>
  );
}

interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error?: string;
  type?: string;
  textarea?: boolean;
}

function Field({ label, name, value, onChange, error, type = 'text', textarea = false }: FieldProps) {
  const id = `bf-${name}`;
  const baseClass = 'rounded-[11px] border border-[rgba(216,184,120,0.14)] bg-bf-input px-4 py-3 font-bodyserif text-[15px] text-bf-cream placeholder:text-bf-muted/70 focus:border-[rgba(216,184,120,0.4)] focus:outline-none';

  return (
    <div>
      <label htmlFor={id} className="block font-sans text-[10px] uppercase tracking-[1.5px] text-bf-muted">
        {label}
      </label>
      {textarea ? (
        <textarea id={id} name={name} value={value} onChange={onChange} rows={3} className={`${baseClass} mt-1 w-full`} />
      ) : (
        <input id={id} name={name} type={type} value={value} onChange={onChange} className={`${baseClass} mt-1 w-full`} />
      )}
      {error && <div className="mt-1 font-sans text-[11px] text-bf-danger">{error}</div>}
    </div>
  );
}
