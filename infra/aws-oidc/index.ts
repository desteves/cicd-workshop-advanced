import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as aws from "@pulumi/aws";
import { stringify } from 'yaml'
import upsertEnvironment from './preview-api-esc';

// Configurations
const audience = pulumi.getOrganization();
const config = new pulumi.Config();
const oidcIdpUrl: string = config.require('oidcIdpUrl');
const thumbprint: string = config.require('thumbprint');
export const escEnv: string = config.require('escEnv');

////// Solve ////////////////////////////////////////
// aws:iam:OpenIdConnectProvider (oidcProvider):
// error: 1 error occurred:
//     * creating IAM OIDC Provider: EntityAlreadyExists: Provider with url https://api.pulumi.com/oidc already exists.
//     status code: 409, request id: 7edf2c50-559a-43cc-a682-f50a40c470bd
// 1. UNCOMMENT THE BELOW CODE SNIPPET
// aws.iam.getOpenIdConnectProvider({
//     url: oidcIdpUrl,
// }).then(temp => {
//     console.log("Ensure you imported your existing OIDC Provider");
//     console.log("pulumi import aws:iam/openIdConnectProvider:OpenIdConnectProvider oidcProvider", temp.arn, "--yes")
// });
// 2. RUN `pulumi preview`
// 3. COPY THE `pulumi import` COMMAND FROM THE CONSOLE AND RUN IT
// 4. COMMENT THE ABOVE CODE SNIPPET
// 5. REPLACE THE RESOURCE DEFINITION BELOW TO THAT OF THE CONSOLE
// 6. RUN `pulumi up`
////////////////////////////////////////`

// Create a new OIDC Provider
const oidcProvider = new aws.iam.OpenIdConnectProvider("oidcProvider", {
    clientIdLists: [audience],
    url: oidcIdpUrl, // Replace with your IdP URL
    thumbprintLists: [thumbprint], // Replace with the thumbprint of the IdP server's certificate
}, {
    protect: true,
});

// Create a new role that can be assumed by the OIDC provider
const role = new aws.iam.Role("oidcProviderRole", {
    assumeRolePolicy: pulumi.all([oidcProvider.url, oidcProvider.arn, audience]).apply(([url, arn, audience]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Federated: arn },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: { StringEquals: { [`${url}:aud`]: [audience] } },
        }],
    })),
}, { dependsOn: [oidcProvider] });

// TODO - attach other policies to the role as needed
try {
    new aws.iam.RolePolicyAttachment("oidcProviderRolePolicyAttachment", {
        role: role,
        policyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    });
} catch (error) {
    console.warn("Unable to attach the AdministratorAccess policy to the " + role.name)
} finally {
    console.log("Please add/remove policies as necessary.")
}

// Create a new Pulumi Cloud access token to be used to create the Environment
const accessToken = new pulumiservice.AccessToken("myAccessToken", {
    description: "Used to create an ESC Environment for AWS OIDC",
}, { dependsOn: [role] });

accessToken.value.apply(tokenId => {
    role.arn.apply(arn => {
        let yamlStr = stringify(
            {
                "values": {
                    "aws": {
                        "login": {
                            "fn::open::aws-login": {
                                "oidc": {
                                    "duration": "1h",
                                    "roleArn": `${arn}`,
                                    "sessionName": "pulumi-environments-session"
                                }
                            }
                        }
                    },
                    "environmentVariables": {
                        "AWS_ACCESS_KEY_ID": "${aws.login.accessKeyId}",
                        "AWS_SECRET_ACCESS_KEY": "${aws.login.secretAccessKey}",
                        "AWS_SESSION_TOKEN": "${aws.login.sessionToken}"
                    }
                },
            }
        );

        yamlStr = yamlStr + '\n';
        upsertEnvironment(yamlStr, audience, escEnv, tokenId);
    });
});