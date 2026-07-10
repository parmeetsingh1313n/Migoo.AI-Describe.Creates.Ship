"use client"
import TypingHeadline from './TypingHeadline';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupTextarea,
} from "@/components/ui/input-group"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { QUICK_VIDEO_SUGGESTIONS } from "@/data/constant"
import { DEFAULT_VOICE_ID, femaleVoices, maleVoices } from "@/data/voices"
import { SignInButton, useUser } from "@clerk/nextjs"
import axios from "axios"

import { Loader2, Send } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

function Hero() {

    const [userInput, setUserInput] = useState('');
    const [type, setType] = useState<'video' | 'article' | 'tutorial' | 'course'>('course');
    const [voice, setVoice] = useState(DEFAULT_VOICE_ID);
    const [loading, setLoading] = useState(false);
    const { user } = useUser();
    const router = useRouter();
    
    const courseId = crypto.randomUUID();

    const GenerateCourseLayout = async () => {
        const toastId = toast.loading("Generating course layout...")

        try { 
        setLoading(true);
        const result = await axios.post('/api/generate-course-layout', {
            userInput,
            type,
            voice,
            courseId
        });
        console.log(result.data);
        setLoading(false);
        toast.success("Course layout generated successfully", {
            id: toastId
        })
            router.push(`/course/${courseId}`);
    } catch (error) {
        setLoading(false);
        toast.error("Failed to generate course layout", {
            id: toastId
        })
    }
}

    return (
        <div className="flex items-center flex-col mt-6">
            <div>
                <TypingHeadline
                  typedText="Learn Smarter with AI Video Courses"
                  delay={500}
                  speed={60}
                  holdDelay={3500}
                  loop={false}
                  className="text-4xl md:text-5xl font-bold text-center"
                />
                <p className="mt-4 text-lg text-center text-muted-foreground">Turn any Topic into a Complete Course</p>
            </div>
            <div className="grid w-full max-w-xl mt-5 gap-6 z-10">
                <InputGroup className="border border-gray-300 rounded-2xl bg-white shadow-sm">
                    <InputGroupTextarea
                        data-slot="input-group-control"
                        className="flex field-sizing-content min-h-24 w-full resize-none rounded-xl bg-transparent px-3 py-2.5 text-base transition-[color,box-shadow] outline-none md:text-md"
                        placeholder="Enter your topic..."
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                    />
                    <InputGroupAddon align="block-end">
                        <Select value={type} onValueChange={(val) => setType(val as 'video' | 'article' | 'tutorial' | 'course')}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="course">Full Course</SelectItem>
                                <SelectItem value="video">Video</SelectItem>
                                <SelectItem value="tutorial">Tutorial</SelectItem>
                                <SelectItem value="article">Article</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={voice} onValueChange={setVoice}>
                            <SelectTrigger className="w-[170px]">
                                <SelectValue placeholder="Select voice" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectLabel>♀ Female Voices</SelectLabel>
                                    {femaleVoices().map((v) => (
                                        <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                                    ))}
                                </SelectGroup>
                                <SelectGroup>
                                    <SelectLabel>♂ Male Voices</SelectLabel>
                                    {maleVoices().map((v) => (
                                        <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        {user ? <InputGroupButton className="ml-auto" size="sm" variant="default" onClick={GenerateCourseLayout} disabled={loading}>
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send />}
                        </InputGroupButton>
                            :
                            <SignInButton>
                                <InputGroupButton className="ml-auto" size="sm" variant="default"><Send /></InputGroupButton>
                            </SignInButton>
                        }
                    </InputGroupAddon>
                </InputGroup>
            </div>
            <div className="flex gap-5 mt-5 max-w-3xl flex-wrap justify-center z-10">
                {QUICK_VIDEO_SUGGESTIONS.map((suggestion, index) => (
                    <div key={index}>
                        <h2 onClick={() => setUserInput(suggestion?.prompt)} className="font-bold border rounded-2xl px-2 p-1  text-sm bg-white cursor-pointer">{suggestion.title}</h2>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default Hero