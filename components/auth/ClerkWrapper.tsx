'use client';

import {
    ClerkProvider,
    RedirectToSignIn,
    SignIn,
    SignUp,
    useAuth,
} from '@clerk/nextjs';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const customAppearance = {
    variables: {
        colorPrimary: '#6366f1',
        colorSuccess: '#10b981',
        colorWarning: '#f59e0b',
        colorDanger: '#ef4444',
        colorBackground: '#ffffff',
        colorText: '#111827',
        colorInputText: '#111827',
        colorInputBackground: '#f9fafb',
        borderRadius: '0.75rem',
        colorAlphaShade: '#1f2937',
        fontSize: '14px',
        fontFamily: 'var(--font-geist-sans)',
    },
    elements: {
        rootBox: 'w-full',
        card: 'bg-transparent shadow-none border-0 p-0',
        header: 'hidden',
        socialButtonsBlockButton: {
            height: '44px',
            padding: '0 16px',
            borderRadius: '9999px',
            backgroundColor: 'var(--muted)',
            color: 'var(--foreground)',
            fontWeight: '500',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            transition: 'all 200ms ease',
            border: '1px solid var(--border)',
            '&:hover': {
                backgroundColor: 'color-mix(in srgb, var(--muted) 90%, transparent)',
                transform: 'translateY(-1px)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
            }
        },
        socialButtonsBlockButtonArrow: { display: 'none' },
        socialButtonsBlockButtonText: { fontWeight: '500' },
        socialButtonsProviderIcon: { width: '18px', height: '18px' },
        dividerLine: { backgroundColor: 'var(--border)' },
        dividerText: {
            color: 'var(--muted-foreground)',
            backgroundColor: 'var(--background)',
            padding: '0 12px',
            fontSize: '13px'
        },
        formFieldLabel: {
            color: 'var(--foreground)',
            fontWeight: '500',
            fontSize: '14px',
            marginBottom: '6px'
        },
        formFieldInput: {
            height: '44px',
            padding: '0 20px',
            borderRadius: '9999px',
            backgroundColor: 'var(--muted)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            fontSize: '14px',
            transition: 'all 200ms ease',
            '&:focus': {
                borderColor: 'var(--primary)',
                boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.1)',
                outline: 'none',
            }
        },
        formButtonPrimary: {
            display: 'none', // Hide Clerk's default button
        },
        footer: { display: 'none' },
        footerActionLink: {
            color: 'var(--primary)',
            fontWeight: '500',
            '&:hover': { textDecoration: 'underline' }
        },
        identityPreviewEditButton: {
            color: 'var(--primary)',
            '&:hover': { color: 'color-mix(in srgb, var(--primary) 80%, transparent)' }
        },
        userButtonBox: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '4px'
        },
        userButtonOuterIdentifier: {
            fontSize: '13px',
            color: 'var(--muted-foreground)'
        },
        navbar: {
            backgroundColor: 'rgba(var(--background), 0.8)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)'
        },
        navbarButton: {
            '&:hover': { backgroundColor: 'var(--muted)' }
        },
    },
};

interface ClerkWrapperProps {
    children: React.ReactNode;
}

export function ClerkProviderWrapper({ children }: ClerkWrapperProps) {
    return (
        <ClerkProvider
            appearance={customAppearance}
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            afterSignInUrl="/"
            afterSignUpUrl="/"
        >
            {children}
        </ClerkProvider>
    );
}

// Custom Sign In Component
export function CustomSignIn() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        // Function to replace Clerk's button with our DrawOutlineButton
        const replaceClerkButton = () => {
            const clerkButton = document.querySelector('.cl-formButtonPrimary') as HTMLButtonElement;
            const formElement = clerkButton?.closest('form');

            if (clerkButton && formElement && !document.getElementById('custom-signin-button')) {
                // Hide the original button
                clerkButton.style.display = 'none';

                // Create container for our custom button
                const buttonContainer = document.createElement('div');
                buttonContainer.id = 'custom-signin-button';
                buttonContainer.className = 'mt-4';

                // Insert after the form's last child
                formElement.appendChild(buttonContainer);

                // We'll trigger the hidden Clerk button when our button is clicked
                const handleCustomClick = () => {
                    clerkButton.click();
                };

                // Create our custom button element matching DrawOutlineButton.tsx
                const customButton = document.createElement('button');
                customButton.type = 'button';
                customButton.className = 'group relative px-6 py-3 font-medium text-slate-900 transition-colors duration-[400ms] hover:text-indigo-600 w-full bg-transparent rounded-lg cursor-pointer';
                customButton.onclick = handleCustomClick;

                // Button text
                const textSpan = document.createElement('span');
                textSpan.className = 'relative z-10';
                textSpan.textContent = 'Continue';
                customButton.appendChild(textSpan);

                // TOP border
                const topSpan = document.createElement('span');
                topSpan.className = 'absolute left-0 top-0 h-[2px] w-0 bg-indigo-600 transition-all duration-100 group-hover:w-full';
                customButton.appendChild(topSpan);

                // RIGHT border
                const rightSpan = document.createElement('span');
                rightSpan.className = 'absolute right-0 top-0 h-0 w-[2px] bg-indigo-600 transition-all delay-100 duration-100 group-hover:h-full';
                customButton.appendChild(rightSpan);

                // BOTTOM border
                const bottomSpan = document.createElement('span');
                bottomSpan.className = 'absolute bottom-0 right-0 h-[2px] w-0 bg-indigo-600 transition-all delay-200 duration-100 group-hover:w-full';
                customButton.appendChild(bottomSpan);

                // LEFT border
                const leftSpan = document.createElement('span');
                leftSpan.className = 'absolute bottom-0 left-0 h-0 w-[2px] bg-indigo-600 transition-all delay-300 duration-100 group-hover:h-full';
                customButton.appendChild(leftSpan);

                buttonContainer.appendChild(customButton);
            }
        };

        // Try multiple times with delays to ensure Clerk has rendered
        const attempts = [100, 300, 500, 1000];
        attempts.forEach(delay => {
            setTimeout(replaceClerkButton, delay);
        });

        // Also observe DOM changes
        const observer = new MutationObserver(() => {
            replaceClerkButton();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => {
            observer.disconnect();
        };
    }, [mounted]);

    if (!mounted) return null;

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-8">
                <div className="relative">
                    <div className="absolute inset-0 bg-linear-to-r from-primary via-secondary to-accent blur-xl opacity-20 animate-pulse-slow" />
                    <Image src={'/logo-transparent.png'} alt='logo' width={100} height={100} />
                </div>

                <h1 className="text-2xl font-semibold text-center text-foreground mb-2">
                    Welcome Back
                </h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                    Sign in to your account
                </p>
            </div>

            <SignIn
                routing="path"
                path="/sign-in"
                appearance={customAppearance}
                signUpUrl="/sign-up"
            />
        </div>
    );
}

// Custom Sign Up Component
export function CustomSignUp() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        // Function to replace Clerk's button with our DrawOutlineButton
        const replaceClerkButton = () => {
            const clerkButton = document.querySelector('.cl-formButtonPrimary') as HTMLButtonElement;
            const formElement = clerkButton?.closest('form');

            if (clerkButton && formElement && !document.getElementById('custom-signup-button')) {
                // Hide the original button
                clerkButton.style.display = 'none';

                // Create container for our custom button
                const buttonContainer = document.createElement('div');
                buttonContainer.id = 'custom-signup-button';
                buttonContainer.className = 'mt-4';

                // Insert after the form's last child
                formElement.appendChild(buttonContainer);

                // We'll trigger the hidden Clerk button when our button is clicked
                const handleCustomClick = () => {
                    clerkButton.click();
                };

                // Create our custom button element matching DrawOutlineButton.tsx
                const customButton = document.createElement('button');
                customButton.type = 'button';
                customButton.className = 'group relative px-6 py-3 font-medium text-slate-900 transition-colors duration-[400ms] hover:text-indigo-600 w-full bg-transparent rounded-lg cursor-pointer';
                customButton.onclick = handleCustomClick;

                // Button text
                const textSpan = document.createElement('span');
                textSpan.className = 'relative z-10';
                textSpan.textContent = 'Continue';
                customButton.appendChild(textSpan);

                // TOP border
                const topSpan = document.createElement('span');
                topSpan.className = 'absolute left-0 top-0 h-[2px] w-0 bg-indigo-600 transition-all duration-100 group-hover:w-full';
                customButton.appendChild(topSpan);

                // RIGHT border
                const rightSpan = document.createElement('span');
                rightSpan.className = 'absolute right-0 top-0 h-0 w-[2px] bg-indigo-600 transition-all delay-100 duration-100 group-hover:h-full';
                customButton.appendChild(rightSpan);

                // BOTTOM border
                const bottomSpan = document.createElement('span');
                bottomSpan.className = 'absolute bottom-0 right-0 h-[2px] w-0 bg-indigo-600 transition-all delay-200 duration-100 group-hover:w-full';
                customButton.appendChild(bottomSpan);

                // LEFT border
                const leftSpan = document.createElement('span');
                leftSpan.className = 'absolute bottom-0 left-0 h-0 w-[2px] bg-indigo-600 transition-all delay-300 duration-100 group-hover:h-full';
                customButton.appendChild(leftSpan);

                buttonContainer.appendChild(customButton);
            }
        };

        // Try multiple times with delays to ensure Clerk has rendered
        const attempts = [100, 300, 500, 1000];
        attempts.forEach(delay => {
            setTimeout(replaceClerkButton, delay);
        });

        // Also observe DOM changes
        const observer = new MutationObserver(() => {
            replaceClerkButton();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => {
            observer.disconnect();
        };
    }, [mounted]);

    if (!mounted) return null;

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-3">
                <div className="relative mb-3">
                    <div className="absolute inset-0 bg-linear-to-r from-primary via-secondary to-accent blur-xl opacity-20 animate-pulse-slow" />
                    <Image src={'/logo-transparent.png'} alt='logo' width={70} height={70} />
                </div>

                <h1 className="text-lg font-semibold text-center text-foreground mb-1">
                    Create Account
                </h1>
                <p className="text-xs text-muted-foreground text-center mb-2">
                    Join us and start creating amazing courses
                </p>
            </div>

            <SignUp
                routing="path"
                path="/sign-up"
                appearance={customAppearance}
                signInUrl="/sign-in"
            />
        </div>
    );
}

// Protected Route Wrapper
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isLoaded, userId } = useAuth();
    const router = useRouter();

    if (!isLoaded) {
        return (
            <div className="h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!userId) {
        return <RedirectToSignIn />;
    }

    return <>{children}</>;
}