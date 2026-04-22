import AuthLayout from '@/components/auth/AuthLayout';
import { CustomSignUp } from '@/components/auth/ClerkWrapper';

export default function SignUpPage() {
    return (
        <AuthLayout>
            <CustomSignUp />
        </AuthLayout>
    );
}