"use client"
import { UserDetailContext } from '@/context/UserDetailContext';
import { useUser } from '@clerk/nextjs';
import axios from 'axios';
import React, { useEffect, useState } from 'react';

function Provider({ children }: { children: React.ReactNode }) {
    const { isSignedIn, isLoaded } = useUser();
    const [userDetail, setUserDetail] = useState(null);

    useEffect(() => {
        const CreateNewUser = async () => {
            if (isLoaded && isSignedIn && !userDetail) {
                try {
                    const result = await axios.post('/api/user', {});
                    console.log(result.data);
                    setUserDetail(result.data);
                } catch (error) {
                    console.error('Error creating user:', error);
                }
            }
        }

        CreateNewUser();
    }, [isSignedIn, isLoaded]);

    return (
        <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
            <div className='min-h-screen'>
                {children}
            </div>
        </UserDetailContext.Provider>
    )
}

export default Provider