import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** `?embed=1` hides the playground header, for iframes in the documentation. */
  protected readonly embedded = new URLSearchParams(location.search).has('embed');
}
