import { inject, signal, Component } from "@angular/core";
import { AuthService } from "../services/auth.service";
import { FormsModule } from "@angular/forms";

// --- Login Component ---
@Component({
    selector: 'app-login',
    standalone: true,
    template: `
        <div class="flex items-center justify-center min-h-screen" style="background-image: url('https://via.placeholder.com/1920x1080/2C2C2C/FFFFFF?Text=Login+Background'); background-size: cover;">
            <div class="bg-slate-700 bg-opacity-80 p-8 rounded-lg shadow-xl w-full max-w-md">
                <div class="text-center mb-8">
                    <img src="https://via.placeholder.com/150/007ACC/FFFFFF?Text=THE+SPRINT+LOGO" alt="The Sprint Logo" class="mx-auto mb-4">
                    <h1 class="text-3xl font-bold">{{ showRegisterForm() ? 'Create Account' : 'Welcome Back!' }}</h1>
                </div>

                <form (submit)="handleAuth()">
                    @if (showRegisterForm()) {
                        <div>
                            <div class="mb-4">
                                <label for="displayName" class="block text-sm font-medium mb-1">Display Name</label>
                                <input type="text" [(ngModel)]="displayName" name="displayName" class="w-full p-3 bg-slate-600 rounded border border-slate-500" placeholder="AgileAvenger">
                            </div>
                        </div>
                    }
                    
                    <div class="mb-4">
                        <label for="email" class="block text-sm font-medium mb-1">Email</label>
                        <input type="email" [(ngModel)]="email" name="email" required class="w-full p-3 bg-slate-600 rounded border border-slate-500" placeholder="you@example.com">
                    </div>
                    <div class="mb-6">
                        <label for="password" class="block text-sm font-medium mb-1">Password</label>
                        <input type="password" [(ngModel)]="password" name="password" required class="w-full p-3 bg-slate-600 rounded border border-slate-500" placeholder="••••••••">
                    </div>

                    @if (showRegisterForm()) {
                        <div class="mb-6">
                            <label for="confirmPassword" class="block text-sm font-medium mb-1">Confirm Password</label>
                            <input type="password" [(ngModel)]="confirmPassword" name="confirmPassword" class="w-full p-3 bg-slate-600 rounded border border-slate-500" placeholder="••••••••">
                        </div>
                    }

                    @if (authError()) {
                        <p class="text-red-400 text-sm mb-4">{{ authError() }}</p>
                    }

                    <button type="submit" class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg text-lg">
                        {{ showRegisterForm() ? 'Register' : 'Log In' }}
                    </button>
                </form>

                <p class="text-center mt-6 text-sm">
                    <a (click)="toggleRegisterForm()" class="text-blue-400 hover:underline font-semibold cursor-pointer">
                        {{ showRegisterForm() ? 'Already have an account? Log In' : 'New to The Sprint? Create an Account' }}
                    </a>
                </p>
                 <p class="text-center mt-4 text-xs text-gray-400">
                    (Note: Email/Pass auth is conceptual. Anonymous sign-in is used by default if no action taken.)
                </p>
            </div>
        </div>
    `,
    imports: [
        FormsModule
    ] // Add FormsModule if using [(ngModel)] - or use reactive forms
})
export class LoginComponent {
    authService = inject(AuthService);
    
    email = '';
    password = '';
    confirmPassword = '';
    displayName = ''; // For registration

    showRegisterForm = signal(false);
    authError = signal<string | null>(null);

    toggleRegisterForm() {
        this.showRegisterForm.set(!this.showRegisterForm());
        this.authError.set(null);
        this.email = ''; this.password = ''; this.confirmPassword = ''; this.displayName = '';
    }

    async handleAuth() {
        this.authError.set(null);
        try {
            if (this.showRegisterForm()) {
                if (this.password !== this.confirmPassword) {
                    this.authError.set("Passwords do not match.");
                    return;
                }
                // TODO: Add display name update if Firebase supports it easily during creation or post-creation
                await this.authService.registerWithEmail(this.email, this.password);
                // On successful registration, user will be auto-logged in by onAuthStateChanged
            } else {
                await this.authService.loginWithEmail(this.email, this.password);
            }
        } catch (error: any) {
            this.authError.set(error.message || "Authentication failed.");
            console.error("Auth error:", error);
        }
    }
}