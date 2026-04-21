import { useState } from 'react';
import { supabase } from './supabase.js';

export function SignInScreen() {
    const [step, setStep] = useState('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSendOtp(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        const { error: err } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
        });
        setLoading(false);
        if (err) {
            setError(err.message);
        } else {
            setStep('verify');
        }
    }

    async function handleVerifyOtp(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        const { error: err } = await supabase.auth.verifyOtp({
            email,
            token: otp,
            type: 'email',
        });
        setLoading(false);
        if (err) {
            setError(err.message);
        }
    }

    function handleBack() {
        setStep('email');
        setOtp('');
        setError('');
    }

    return (
        <main className="prototype-shell signin-screen">
            <div className="signin-inner">
                <div className="signin-brand">
                    <span className="leaf-icon" aria-hidden="true" />
                    <h1 className="signin-title">GreenCredit</h1>
                </div>

                {step === 'email' ? (
                    <form className="signin-form" onSubmit={handleSendOtp} noValidate>
                        <p className="signin-heading">Sign in</p>
                        <p className="signin-subheading">
                            Enter your email to receive a one-time code.
                        </p>
                        <label className="signin-label" htmlFor="signin-email">
                            Email address
                        </label>
                        <input
                            id="signin-email"
                            className="signin-input"
                            type="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                        />
                        {error && <p className="signin-error" role="alert">{error}</p>}
                        <button
                            className="signin-btn"
                            type="submit"
                            disabled={loading || !email.trim()}
                        >
                            {loading ? 'Sending…' : 'Send code'}
                        </button>
                    </form>
                ) : (
                    <form className="signin-form" onSubmit={handleVerifyOtp} noValidate>
                        <button
                            type="button"
                            className="signin-back"
                            onClick={handleBack}
                            aria-label="Back to email"
                        >
                            <span aria-hidden="true" />
                        </button>
                        <p className="signin-heading">Check your email</p>
                        <p className="signin-subheading">
                            We sent a 6-digit code to{' '}
                            <strong className="signin-email-display">{email}</strong>.
                        </p>
                        <label className="signin-label" htmlFor="signin-otp">
                            One-time code
                        </label>
                        <input
                            id="signin-otp"
                            className="signin-input signin-input--otp"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="000000"
                            maxLength={6}
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                            required
                            disabled={loading}
                            autoFocus
                        />
                        {error && <p className="signin-error" role="alert">{error}</p>}
                        <button
                            className="signin-btn"
                            type="submit"
                            disabled={loading || otp.length < 6}
                        >
                            {loading ? 'Verifying…' : 'Verify code'}
                        </button>
                        <button
                            type="button"
                            className="signin-resend"
                            onClick={handleSendOtp}
                            disabled={loading}
                        >
                            Resend code
                        </button>
                    </form>
                )}
            </div>
        </main>
    );
}
