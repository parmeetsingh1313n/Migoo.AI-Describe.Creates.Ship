import AuthLayout from '@/components/auth/AuthLayout';
import { CustomSignIn } from '@/components/auth/ClerkWrapper';

export default function SignInPage() {
    return (
        <AuthLayout>
            <CustomSignIn />
        </AuthLayout>
    );
}