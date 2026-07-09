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
        colorPrimary: '#ffffff',
        colorSuccess: '#10b981',
        colorWarning: '#f59e0b',
        colorDanger: '#ef4444',
        colorBackground: 'transparent',
        colorText: '#ffffff',
        colorInputText: '#ffffff',
        colorInputBackground: 'rgba(255, 255, 255, 0.08)',
        borderRadius: '0.75rem',
        colorAlphaShade: 'rgba(255, 255, 255, 0.1)',
        fontSize: '14px',
        fontFamily: "'Outfit', sans-serif",
    },
    elements: {
        rootBox: 'w-full',
        card: 'bg-transparent shadow-none border-0 p-0',
        header: 'hidden',
        socialButtonsBlockButton: {
            height: '44px',
            padding: '0 16px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(12px)',
            color: 'rgba(255, 255, 255, 0.8)',
            fontWeight: '500',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            transition: 'all 200ms ease',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                transform: 'translateY(-1px)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
            }
        },
        socialButtonsBlockButtonArrow: { display: 'none' },
        socialButtonsBlockButtonText: { fontWeight: '500', color: 'rgba(255,255,255,0.8)' },
        socialButtonsProviderIcon: { width: '20px', height: '20px' },
        dividerLine: { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
        dividerText: {
            color: 'rgba(255, 255, 255, 0.5)',
            backgroundColor: 'transparent',
            padding: '0 12px',
            fontSize: '13px'
        },
        formFieldLabel: {
            color: 'rgba(255, 255, 255, 0.7)',
            fontWeight: '500',
            fontSize: '14px',
            marginBottom: '6px'
        },
        formFieldInput: {
            height: '44px',
            padding: '0 20px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            fontSize: '14px',
            transition: 'all 200ms ease',
            '&:focus': {
                borderColor: 'rgba(255, 255, 255, 0.3)',
                boxShadow: '0 0 0 3px rgba(255, 255, 255, 0.08)',
                outline: 'none',
            }
        },
        formButtonPrimary: {
            display: 'none',
        },
        footer: { display: 'none' },
        footerActionLink: {
            color: 'rgba(255, 255, 255, 0.7)',
            fontWeight: '500',
            '&:hover': { textDecoration: 'underline', color: '#ffffff' }
        },
        identityPreviewEditButton: {
            color: 'rgba(255, 255, 255, 0.7)',
            '&:hover': { color: '#ffffff' }
        },
        identityPreview: {
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            borderRadius: '9999px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
        },
        identityPreviewText: {
            color: 'rgba(255, 255, 255, 0.8)',
        },
        formFieldAction: {
            color: 'rgba(255, 255, 255, 0.5)',
            '&:hover': { color: '#ffffff' }
        },
        formFieldSuccessText: { color: '#10b981' },
        formFieldErrorText: { color: '#f87171' },
        otpCodeFieldInput: {
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            borderRadius: '0.75rem',
        },
        alternativeMethodsBlockButton: {
            color: 'rgba(255, 255, 255, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
            }
        },
        userButtonBox: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '4px'
        },
        userButtonOuterIdentifier: {
            fontSize: '13px',
            color: 'rgba(255, 255, 255, 0.6)'
        },
        userButtonPopoverCard: {
            backgroundColor: '#ffffff !important',
            color: '#171717 !important',
            border: '1px solid #f0f0f0 !important',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15) !important',
            borderRadius: '16px !important',
            overflow: 'hidden !important',
        },
        userButtonPopoverMain: {
            backgroundColor: '#ffffff !important',
            color: '#171717 !important',
        },
        userButtonPopoverActions: {
            backgroundColor: '#ffffff !important',
        },
        userButtonPopoverActionButton: {
            color: '#171717 !important',
            '&:hover': {
                backgroundColor: '#f5f5f5 !important',
            }
        },
        userButtonPopoverActionButtonText: {
            color: '#171717 !important',
            fontWeight: '500 !important',
        },
        userButtonPopoverActionButtonIcon: {
            color: '#737373 !important',
        },
        userPreviewMainIdentifier: {
            color: '#171717 !important',
            fontWeight: '600 !important',
        },
        userPreviewSecondaryIdentifier: {
            color: '#737373 !important',
        },
        userButtonPopoverFooter: {
            display: 'none !important',
        },
        navbar: {
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        },
        navbarButton: {
            '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)' }
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

        const replaceClerkButton = () => {
            const clerkButton = document.querySelector('.cl-formButtonPrimary') as HTMLButtonElement;
            const formElement = clerkButton?.closest('form');

            if (clerkButton && formElement && !document.getElementById('custom-signin-button')) {
                clerkButton.style.display = 'none';

                const buttonContainer = document.createElement('div');
                buttonContainer.id = 'custom-signin-button';
                buttonContainer.className = 'mt-4';
                formElement.appendChild(buttonContainer);

                const handleCustomClick = () => { clerkButton.click(); };

                const customButton = document.createElement('button');
                customButton.type = 'button';
                customButton.className = 'w-full py-3 px-6 rounded-full text-white font-medium text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer font-[Outfit]';
                customButton.style.cssText = 'background: rgba(255,255,255,0.09); backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%); border: 1px solid rgba(255,255,255,0.25); box-shadow: inset 0 1px 1px rgba(255,255,255,0.22), 0 4px 24px rgba(0,0,0,0.3);';
                customButton.onclick = handleCustomClick;
                customButton.textContent = 'Continue';

                buttonContainer.appendChild(customButton);
            }
        };

        const attempts = [100, 300, 500, 1000];
        attempts.forEach(delay => { setTimeout(replaceClerkButton, delay); });

        const observer = new MutationObserver(() => { replaceClerkButton(); });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => { observer.disconnect(); };
    }, [mounted]);

    if (!mounted) return null;

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-5">
                <div className="relative">
                    <Image src={'/logo-transparent.png'} alt='logo' width={64} height={64} />
                </div>

                <h1 className="text-xl font-semibold text-center text-white mb-1 font-['Outfit']">
                    Welcome Back
                </h1>
                <p className="text-sm text-white/50 text-center mb-4 font-['Outfit']">
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

        const replaceClerkButton = () => {
            const clerkButton = document.querySelector('.cl-formButtonPrimary') as HTMLButtonElement;
            const formElement = clerkButton?.closest('form');

            if (clerkButton && formElement && !document.getElementById('custom-signup-button')) {
                clerkButton.style.display = 'none';

                const buttonContainer = document.createElement('div');
                buttonContainer.id = 'custom-signup-button';
                buttonContainer.className = 'mt-4';
                formElement.appendChild(buttonContainer);

                const handleCustomClick = () => { clerkButton.click(); };

                const customButton = document.createElement('button');
                customButton.type = 'button';
                customButton.className = 'w-full py-3 px-6 rounded-full text-white font-medium text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer font-[Outfit]';
                customButton.style.cssText = 'background: rgba(255,255,255,0.09); backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%); border: 1px solid rgba(255,255,255,0.25); box-shadow: inset 0 1px 1px rgba(255,255,255,0.22), 0 4px 24px rgba(0,0,0,0.3);';
                customButton.onclick = handleCustomClick;
                customButton.textContent = 'Continue';

                buttonContainer.appendChild(customButton);
            }
        };

        const attempts = [100, 300, 500, 1000];
        attempts.forEach(delay => { setTimeout(replaceClerkButton, delay); });

        const observer = new MutationObserver(() => { replaceClerkButton(); });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => { observer.disconnect(); };
    }, [mounted]);

    if (!mounted) return null;

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-3">
                <div className="relative mb-2">
                    <Image src={'/logo-transparent.png'} alt='logo' width={60} height={60} />
                </div>

                <h1 className="text-lg font-semibold text-center text-white mb-1 font-['Outfit']">
                    Create Account
                </h1>
                <p className="text-xs text-white/50 text-center mb-2 font-['Outfit']">
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