declare module 'swagger-ui-react' {
  import { Component } from 'react';

  export interface SwaggerUIProps {
    url?: string;
    spec?: object;
    docExpansion?: 'list' | 'full' | 'none';
    filter?: string | boolean;
    onComplete?: (system: any) => void;
  }

  export default class SwaggerUI extends Component<SwaggerUIProps> {}
}
