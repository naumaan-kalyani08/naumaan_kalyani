import { useId, useRef, useState } from "react";
import gsap from "gsap";
import { profile } from "../data/content";
import { prefersReducedMotion } from "../lib/scroll";
import "../style/ContactForm.css";

/*
 * Project enquiry form.
 *
 * Delivery: Web3Forms (https://web3forms.com). Set VITE_WEB3FORMS_KEY in .env
 * to the access key Web3Forms emails you; each submission is then emailed to
 * you. The key is public by design (it can only send mail to your inbox).
 * Without it, "Send" opens the visitor's mail app with everything pre-filled
 * (addressed to profile.email), so the form still works.
 */
const ACCESS_KEY = import.meta.env.VITE_NK_CS_FM;
const ENDPOINT = "https://api.web3forms.com/submit";
const TOPICS = ["Website", "Web app", "3D / animation", "Something else"];
const BUDGETS = ["< $1k", "$1k – $5k", "$5k – $10k", "$10k +"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const validate = (values) => {
  const errors = {};
  if (!values.name.trim()) errors.name = "Tell me your name.";
  if (!EMAIL_RE.test(values.email.trim())) errors.email = "Enter an email I can reply to, like you@example.com.";
  if (values.message.trim().length < 10) errors.message = "Add a few words about the project (10+ characters).";
  return errors;
};

function Chips({ legend, name, options, value, onChange }) {
  return (
    <fieldset className="cform__chips">
      <legend className="cform__legend">{legend}</legend>
      <div className="cform__chip-row">
        {options.map((option) => (
          <label key={option} className={`cform__chip ${value === option ? "is-on" : ""}`}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function ContactForm() {
  const id = useId();
  const formRef = useRef(null);
  const [values, setValues] = useState({ name: "", email: "", topic: TOPICS[0], budget: "", message: "", company: "" });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState("idle"); // idle | sending | sent | mailto | error

  const set = (field) => (event) => {
    const value = typeof event === "string" ? event : event.target.value;
    const next = { ...values, [field]: value };
    setValues(next);
    if (touched[field]) setErrors(validate(next));
  };
  const blur = (field) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(validate(values));
  };

  const shake = () => {
    if (prefersReducedMotion()) return;
    gsap.fromTo(formRef.current, { x: 0 }, { x: 0, duration: 0.5, ease: "none", keyframes: { x: [0, -10, 9, -6, 4, 0] } });
  };

  const openMail = () => {
    const subject = `${values.topic} enquiry from ${values.name.trim()}`;
    const body = [
      values.message.trim(),
      "",
      `— ${values.name.trim()} (${values.email.trim()})`,
      values.budget ? `Budget: ${values.budget}` : "",
    ]
      .filter((line, i, all) => line || i < all.length - 1)
      .join("\n");
    window.location.href = `mailto:${profile.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    setTouched({ name: true, email: true, message: true });
    if (Object.keys(found).length) {
      shake();
      formRef.current.querySelector("[aria-invalid='true']")?.focus();
      return;
    }
    if (values.company) return; // honeypot: bots fill hidden fields

    if (!ACCESS_KEY) {
      openMail();
      setStatus("mailto");
      return;
    }

    setStatus("sending");
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: ACCESS_KEY,
          subject: `${values.topic} enquiry from ${values.name.trim()}`,
          from_name: "Portfolio contact form",
          name: values.name.trim(),
          email: values.email.trim(),
          topic: values.topic,
          budget: values.budget || "Not specified",
          message: values.message.trim(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.message || `HTTP ${response.status}`);
      setStatus("sent");
      setValues((v) => ({ ...v, message: "" }));
      setTouched({});
    } catch {
      setStatus("error");
    }
  };

  const field = (name) => ({
    id: `${id}-${name}`,
    name,
    value: values[name],
    onChange: set(name),
    onBlur: blur(name),
    "aria-invalid": touched[name] && errors[name] ? "true" : "false",
    "aria-describedby": errors[name] && touched[name] ? `${id}-${name}-error` : undefined,
  });

  const FieldError = ({ name }) =>
    touched[name] && errors[name] ? (
      <span className="cform__error" id={`${id}-${name}-error`}>
        {errors[name]}
      </span>
    ) : null;

  return (
    <div className="cform-wrap" data-reveal>
      <div className="cform__intro">
        <p className="eyebrow">Start a project</p>
        <h3 className="cform__title">Tell me what you&apos;re building.</h3>
        <p className="cform__lede">
          A few lines are enough: what it is, who it&apos;s for and when you&apos;d like it live. I reply within two working
          days.
        </p>
        <ul className="cform__points">
          <li>Websites, web apps and interactive 3D</li>
          <li>React front-ends and Laravel back-ends</li>
          <li>Freelance projects or a full-time role</li>
        </ul>
      </div>

      <form className="cform" ref={formRef} onSubmit={onSubmit} noValidate>
        <div className="cform__row">
          <div className="cform__field">
            <input className="cform__input" type="text" autoComplete="name" placeholder=" " {...field("name")} />
            <label className="cform__label" htmlFor={`${id}-name`}>
              Your name
            </label>
            <FieldError name="name" />
          </div>
          <div className="cform__field">
            <input className="cform__input" type="email" autoComplete="email" inputMode="email" placeholder=" " {...field("email")} />
            <label className="cform__label" htmlFor={`${id}-email`}>
              Email
            </label>
            <FieldError name="email" />
          </div>
        </div>

        <Chips legend="What do you need?" name="topic" options={TOPICS} value={values.topic} onChange={set("topic")} />
        <Chips legend="Budget (optional)" name="budget" options={BUDGETS} value={values.budget} onChange={set("budget")} />

        <div className="cform__field">
          <textarea className="cform__input cform__textarea" rows="5" placeholder=" " {...field("message")} />
          <label className="cform__label" htmlFor={`${id}-message`}>
            About the project
          </label>
          <FieldError name="message" />
        </div>

        {/* Honeypot — hidden from people, tempting to bots. */}
        <div className="cform__hp" aria-hidden="true">
          <label htmlFor={`${id}-company`}>Company</label>
          <input id={`${id}-company`} name="company" tabIndex={-1} autoComplete="off" value={values.company} onChange={set("company")} />
        </div>

        <div className="cform__foot">
          <button type="submit" className="btn btn--primary cform__submit" disabled={status === "sending"} data-magnetic="0.2">
            {status === "sending" ? "Sending…" : "Send message"} <span className="btn__arrow" aria-hidden="true">→</span>
          </button>
          <p className={`cform__status cform__status--${status}`} role="status" aria-live="polite">
            {status === "sent" && "Thanks! Your message is on its way. I’ll reply within two working days."}
            {status === "mailto" && `Your email app should open with the message ready. If it doesn’t, write to ${profile.email}.`}
            {status === "error" && `That didn’t send. Check your connection and try again, or email ${profile.email}.`}
          </p>
        </div>
      </form>
    </div>
  );
}
